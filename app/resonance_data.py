"""
pktHub — the assistant's data surface, federated across the registered apps.

Documents published here:

  GET /.well-known/resonance.json   what the assistant may call. Names only.
  GET /api/resonance/openapi.json   the OpenAPI description of those calls.
  GET /api/resonance/data/...       pktHub's own operations.
  ANY /api/resonance/data/{app}/... a registered app's own operation, proxied.

WHY THIS IS COMPOSED AND NOT WRITTEN

Every sibling app already publishes exactly these two documents for itself: a
grant naming the operations it permits, and an OpenAPI narrowed to them. pktHub
does not re-describe nine apps' worth of operations by hand — it fetches what
each app already declares and merges it. Hand-copying would be ninety
operations that drift silently the first time any app renames a field, which is
the failure a hand-kept spec always ends in: the assistant confidently sending
something that stopped existing.

So this file is mostly a composer, and the same shape as the APPS sidebar: the
app declares, the hub mirrors.

THE CEILING, WHICH IS THE POINT

pktHub holds a suite token for every registered app. A proxy that forwarded
whatever it was asked would therefore be an open door to every app's entire
API, authenticated. It is not one:

  - an operation reaches the federated documents only if it is in that app's
    own grant. pktHub can never widen what an app permits, only narrow it.
  - a proxied request is matched against the granted (method, path) pairs from
    that app's spec before anything is forwarded. No match, no call.
  - write operations are withheld entirely while resonance_allow_writes is off,
    which is the shipped default. An app may grant writes to its own assistant;
    that does not grant them here.

Read app/resonance.py for the embed side — this file is only the data.
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import re
import time
from typing import Any

import aiosqlite
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.crypto import decrypt_str
from app.database import get_db
from app.resonance import resonance_session_user

log = logging.getLogger("pkthub.resonance.data")

router = APIRouter(tags=["resonance-data"])

SPEC_PATH = "/api/resonance/openapi.json"
GRANT_PATH = "/.well-known/resonance.json"
DATA_PREFIX = "/api/resonance/data"

SUITE_VERSION = 1

# An app's documents change when the app is upgraded, not minute to minute, and
# resonance re-reads the spec rarely. Short enough that a newly registered app
# appears without a restart, long enough that a busy conversation is not fetching
# nine specs per question.
CACHE_TTL_SECONDS = 300

# A spec is a document, not a data set — but it is fetched from an app that could
# be wedged, and a hung fetch here stalls the assistant rather than one panel.
FETCH_TIMEOUT = 8.0


# ── Fetching what each app declares ───────────────────────────────────────────

class _Entry:
    __slots__ = ("grant", "spec", "fetched_at", "error")

    def __init__(self, grant: dict | None, spec: dict | None, error: str = ""):
        self.grant = grant
        self.spec = spec
        self.fetched_at = time.monotonic()
        self.error = error

    @property
    def fresh(self) -> bool:
        return (time.monotonic() - self.fetched_at) < CACHE_TTL_SECONDS


_cache: dict[int, _Entry] = {}
_cache_lock = asyncio.Lock()


def invalidate_cache(app_id: int | None = None) -> None:
    """Drop cached documents. Called when the registry changes, so registering an
    app does not leave the assistant blind to it for the rest of the TTL."""
    if app_id is None:
        _cache.clear()
    else:
        _cache.pop(app_id, None)


async def _fetch_documents(base_url: str, suite_token: str) -> _Entry:
    """Read one app's grant and spec. Both, or neither — a spec without the
    grant that bounds it is exactly the thing this must not act on."""
    base = base_url.rstrip("/")
    headers = {"X-Suite-Token": suite_token, "X-Suite-Version": str(SUITE_VERSION)}
    try:
        async with httpx.AsyncClient(verify=False, timeout=FETCH_TIMEOUT) as client:
            g = await client.get(f"{base}{GRANT_PATH}", headers=headers)
            if g.status_code != 200:
                return _Entry(None, None, f"grant returned HTTP {g.status_code}")
            grant = g.json()

            spec_path = str(grant.get("spec") or SPEC_PATH)
            if not spec_path.startswith("/"):
                return _Entry(None, None, "grant names a non-relative spec path")
            s = await client.get(f"{base}{spec_path}", headers=headers)
            if s.status_code != 200:
                return _Entry(None, None, f"spec returned HTTP {s.status_code}")
            spec = s.json()
    except Exception as exc:                                  # noqa: BLE001
        return _Entry(None, None, f"unreachable: {exc}")

    if not isinstance(grant, dict) or not isinstance(grant.get("allow"), list):
        return _Entry(None, None, "grant is not in the expected shape")
    if not isinstance(spec, dict) or not isinstance(spec.get("paths"), dict):
        return _Entry(None, None, "spec is not in the expected shape")
    return _Entry(grant, spec)


async def _registered_apps(db: aiosqlite.Connection) -> list[dict]:
    async with db.execute(
        "SELECT id, name, display_name, base_url, suite_token, health_status "
        "FROM registered_apps ORDER BY name"
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def _catalog(db: aiosqlite.Connection) -> dict[int, tuple[dict, _Entry]]:
    """Every registered app that publishes a usable grant, with its documents.

    An app that is down, or that has no resonance surface, is skipped rather
    than failing the whole catalogue: one unreachable app must not take the
    assistant's knowledge of the other eight with it.
    """
    out: dict[int, tuple[dict, _Entry]] = {}
    apps = await _registered_apps(db)

    async with _cache_lock:
        stale = [a for a in apps if not (_cache.get(a["id"]) and _cache[a["id"]].fresh)]
        if stale:
            fetched = await asyncio.gather(*[
                _fetch_documents(a["base_url"], decrypt_str(a["suite_token"]))
                for a in stale
            ], return_exceptions=True)
            for a, entry in zip(stale, fetched):
                if isinstance(entry, BaseException):
                    entry = _Entry(None, None, f"fetch failed: {entry}")
                _cache[a["id"]] = entry
                if entry.error:
                    log.info("resonance: no data surface from %s — %s", a["name"], entry.error)

    for a in apps:
        entry = _cache.get(a["id"])
        if entry and entry.grant and entry.spec:
            out[a["id"]] = (a, entry)
    return out


# ── Settings ──────────────────────────────────────────────────────────────────

async def _setting(db: aiosqlite.Connection, key: str, default=None):
    async with db.execute("SELECT value FROM platform_config WHERE key = ?", (key,)) as cur:
        row = await cur.fetchone()
    if not row or row[0] is None:
        return default
    try:
        return json.loads(row[0])
    except (json.JSONDecodeError, TypeError, ValueError):
        return row[0]


async def writes_allowed(db: aiosqlite.Connection) -> bool:
    """Off unless an admin has deliberately turned it on.

    An app granting a write to its own assistant is that app's decision about
    one app. Passing it through here would make it a decision about the whole
    estate, taken by somebody who never saw this switch.
    """
    value = await _setting(db, "resonance_allow_writes", False)
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


# ── Composition ───────────────────────────────────────────────────────────────

def _granted_ops(grant: dict, allow_writes: bool) -> dict[str, bool]:
    """operationId -> writes, for the operations this app actually permits."""
    ops: dict[str, bool] = {}
    for item in grant.get("allow") or []:
        if not isinstance(item, dict):
            continue
        op = str(item.get("op") or "")
        if not op:
            continue
        writes = bool(item.get("writes"))
        if writes and not allow_writes:
            continue
        ops[op] = writes
    return ops


def _rename_refs(node: Any, rename: dict[str, str]) -> None:
    """Point every $ref at its namespaced schema, in place."""
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            old = ref.rsplit("/", 1)[-1]
            if old in rename:
                node["$ref"] = f"#/components/schemas/{rename[old]}"
        for value in node.values():
            _rename_refs(value, rename)
    elif isinstance(node, list):
        for value in node:
            _rename_refs(value, rename)


# pktHub's own operations, declared the way a sibling app declares its GRANTED
# tuple: the grant is generated from this list and the spec filtered to it, so
# the two cannot disagree. An operationId absent here is invisible to the
# assistant even though it is a perfectly ordinary route of this app.
HUB_GRANTED: tuple[str, ...] = (
    "getEstateHealth",
)


def _hub_operations(fastapi_app) -> tuple[dict, dict, list[dict]]:
    """pktHub's own granted operations, from the live routes.

    Read off app.openapi() rather than written out here, so a response model
    that changes shape changes in the published document too — the failure a
    hand-kept spec always ends in is the assistant confidently sending a field
    that stopped existing.
    """
    full = fastapi_app.openapi()
    paths: dict[str, Any] = {}
    allow: list[dict] = []

    for path, item in (full.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        kept = {}
        for method, operation in item.items():
            if not isinstance(operation, dict):
                continue
            op_id = operation.get("operationId")
            if op_id not in HUB_GRANTED:
                continue
            copied = copy.deepcopy(operation)
            copied.pop("security", None)
            kept[method] = copied
            allow.append({"op": op_id})
        if kept:
            paths[path] = kept

    wanted: set[str] = set()
    _collect_refs(paths, wanted)
    all_schemas = (full.get("components") or {}).get("schemas") or {}
    schemas: dict[str, Any] = {}
    while wanted:
        name = wanted.pop()
        if name in schemas or name not in all_schemas:
            continue
        schemas[name] = copy.deepcopy(all_schemas[name])
        nested: set[str] = set()
        _collect_refs(all_schemas[name], nested)
        wanted |= nested - set(schemas)

    missing = [op for op in HUB_GRANTED if not any(
        o.get("op") == op for o in allow
    )]
    if missing:
        # The quiet failure mode of this whole arrangement: the assistant asks
        # for it, gets a 404, and reports pktHub as having no such capability
        # rather than as misconfigured.
        log.error("resonance grant names %d hub operation(s) that do not exist: %s",
                  len(missing), ", ".join(missing))

    return paths, schemas, allow


def _collect_refs(node: Any, out: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            out.add(ref.rsplit("/", 1)[-1])
        for value in node.values():
            _collect_refs(value, out)
    elif isinstance(node, list):
        for value in node:
            _collect_refs(value, out)


def _compose(catalog: dict[int, tuple[dict, _Entry]], allow_writes: bool) -> tuple[dict, list[dict]]:
    """Merge every app's granted operations into one document.

    Names are namespaced by app because two apps legitimately both have
    `listAlertEvents` and `AlertEvent`, and an OpenAPI document with either
    colliding is not a document the assistant can use. The app name is also the
    only thing telling the assistant which system it is asking about.
    """
    paths: dict[str, Any] = {}
    schemas: dict[str, Any] = {}
    allow: list[dict] = []

    for app, entry in catalog.values():
        name = app["name"]
        ops = _granted_ops(entry.grant, allow_writes)
        if not ops:
            continue

        spec = entry.spec
        rename = {
            s: f"{name}_{s}"
            for s in ((spec.get("components") or {}).get("schemas") or {})
        }

        for path, item in (spec.get("paths") or {}).items():
            if not isinstance(item, dict):
                continue
            kept = {}
            for method, operation in item.items():
                if not isinstance(operation, dict):
                    continue
                op_id = operation.get("operationId")
                if op_id not in ops:
                    continue
                copied = copy.deepcopy(operation)
                copied["operationId"] = f"{name}_{op_id}"
                # Say which system, in the words the assistant reads. Without
                # this, nine near-identical "List alert events" summaries are
                # nine coin flips.
                summary = copied.get("summary") or op_id
                copied["summary"] = f"[{app['display_name'] or name}] {summary}"
                copied.pop("security", None)
                _rename_refs(copied, rename)
                kept[method] = copied
                allow.append(
                    {"op": f"{name}_{op_id}", **({"writes": True} if ops[op_id] else {})}
                )
            if kept:
                paths[f"{DATA_PREFIX}/{name}{path}"] = kept

        for old, new in rename.items():
            schema = copy.deepcopy((spec.get("components") or {}).get("schemas", {})[old])
            _rename_refs(schema, rename)
            schemas[new] = schema

    doc = {
        "openapi": "3.1.0",
        "info": {
            "title": "pktHub — suite data",
            "version": "1",
            "description": (
                "Read access across every app registered with this pktHub. Each "
                "operation is prefixed with the app it belongs to. pktHub holds "
                "the credentials; the assistant never sees them."
            ),
        },
        "paths": paths,
        "components": {"schemas": schemas},
    }
    return doc, allow


# ── The ceiling: what may actually be proxied ─────────────────────────────────

def _path_pattern(template: str) -> re.Pattern[str]:
    """An OpenAPI path template as a regex. {param} matches one path segment."""
    out = []
    for part in re.split(r"(\{[^}]+\})", template):
        if part.startswith("{") and part.endswith("}"):
            out.append(r"[^/]+")
        else:
            out.append(re.escape(part))
    return re.compile("^" + "".join(out) + "$")


def _is_granted(entry: _Entry, method: str, path: str, allow_writes: bool) -> bool:
    """Whether this exact call is one the app declared and granted.

    Matched against the app's own spec rather than a rule of thumb about what
    the path looks like: the grant is the contract, and anything not in it is
    refused even though pktHub holds a token that would open it.
    """
    ops = _granted_ops(entry.grant, allow_writes)
    if not ops:
        return False
    for template, item in (entry.spec.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        operation = item.get(method.lower())
        if not isinstance(operation, dict):
            continue
        if operation.get("operationId") not in ops:
            continue
        if _path_pattern(template).match(path):
            return True
    return False


# ── Published documents ───────────────────────────────────────────────────────

@router.get(GRANT_PATH, include_in_schema=False)
async def resonance_grant(request: Request, db: aiosqlite.Connection = Depends(get_db)):
    """What this pktHub permits the assistant to call. Names only, no data.

    Public by contract — resonance reads it before anyone signs in, and it
    carries nothing but operation names.
    """
    catalog = await _catalog(db)
    _, allow = _compose(catalog, await writes_allowed(db))
    _, _, hub_allow = _hub_operations(request.app)
    allow = hub_allow + allow
    log.info("resonance grant fetched: %d operation(s) — %d from pktHub, %d across %d app(s)",
             len(allow), len(hub_allow), len(allow) - len(hub_allow), len(catalog))
    return JSONResponse(
        {"resonance": 1, "spec": SPEC_PATH, "allow": allow},
        headers={"Cache-Control": "no-store"},
    )


@router.get(SPEC_PATH, include_in_schema=False)
async def resonance_spec(request: Request, db: aiosqlite.Connection = Depends(get_db)):
    """The federated OpenAPI, narrowed to the granted operations.

    pktHub's own operations come first: they are the ones about the estate as a
    whole, and the questions people actually open the hub to ask.
    """
    catalog = await _catalog(db)
    doc, _ = _compose(catalog, await writes_allowed(db))
    hub_paths, hub_schemas, _ = _hub_operations(request.app)
    doc["paths"] = {**hub_paths, **doc["paths"]}
    doc["components"]["schemas"] = {**hub_schemas, **doc["components"]["schemas"]}
    return JSONResponse(doc, headers={"Cache-Control": "no-store"})


# ── pktHub's own operations ───────────────────────────────────────────────────
#
# The questions no single app can answer, because they are about the estate
# rather than about one system.

class RegisteredApp(BaseModel):
    name: str
    display_name: str
    health: str
    has_data_surface: bool


class EstateHealth(BaseModel):
    total: int
    healthy: int
    degraded: int
    unreachable: int
    apps: list[RegisteredApp]


@router.get(
    f"{DATA_PREFIX}/estate-health",
    operation_id="getEstateHealth",
    summary="[pktHub] Health of every registered app",
    response_model=EstateHealth,
)
async def get_estate_health(
    _user: dict = Depends(resonance_session_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Which apps are registered with this hub, and which are answering."""
    apps = await _registered_apps(db)
    catalog = await _catalog(db)
    out = [
        RegisteredApp(
            name=a["name"],
            display_name=a["display_name"] or a["name"],
            health=a["health_status"] or "unknown",
            has_data_surface=a["id"] in catalog,
        )
        for a in apps
    ]
    counts = {"healthy": 0, "degraded": 0, "unreachable": 0}
    for a in out:
        if a.health in counts:
            counts[a.health] += 1
    return EstateHealth(total=len(out), **counts, apps=out)


# ── Proxy ─────────────────────────────────────────────────────────────────────

@router.api_route(
    DATA_PREFIX + "/{app_name}/{path:path}",
    methods=["GET", "POST", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def proxy_app_operation(
    app_name: str,
    path: str,
    request: Request,
    current_user: dict = Depends(resonance_session_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Forward one granted operation to the app that owns it.

    Authenticated as the person asking, not as the hub: resonance calls this
    with the caller's session, and the app is told which user and role pktHub is
    vouching for so its own checks still apply.
    """
    catalog = await _catalog(db)
    match = next(
        ((a, e) for a, e in catalog.values() if a["name"] == app_name), None
    )
    if not match:
        raise HTTPException(status_code=404, detail="No such app, or it publishes no data surface")
    app, entry = match

    allow_writes = await writes_allowed(db)
    target_path = "/" + path.lstrip("/")
    if not _is_granted(entry, request.method, target_path, allow_writes):
        # Deliberately the same answer as an unknown app: whether an operation
        # exists but is ungranted is not something worth disclosing here.
        raise HTTPException(status_code=404, detail="Not a granted operation")

    url = f"{app['base_url'].rstrip('/')}{target_path}"
    if request.url.query:
        url += f"?{request.url.query}"

    headers = {
        "X-Suite-Token": decrypt_str(app["suite_token"]),
        "X-Suite-Version": str(SUITE_VERSION),
        "X-Suite-User": current_user.get("username", ""),
        "X-Suite-Role": current_user.get("role", "viewer"),
        "Content-Type": "application/json",
    }
    body = await request.body()

    try:
        async with httpx.AsyncClient(verify=False, timeout=FETCH_TIMEOUT) as client:
            resp = await client.request(
                request.method, url, headers=headers, content=body or None
            )
    except Exception as exc:                                  # noqa: BLE001
        log.warning("resonance proxy to %s failed: %s", app_name, exc)
        raise HTTPException(status_code=503, detail=f"{app_name} did not answer") from exc

    try:
        return JSONResponse(resp.json(), status_code=resp.status_code)
    except Exception:                                          # noqa: BLE001
        return JSONResponse(
            {"error": f"{app_name} returned a non-JSON response"}, status_code=502
        )
