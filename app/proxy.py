from fastapi import APIRouter, Request, Response, Depends, HTTPException
from urllib.parse import urlparse
import re
import gzip
import httpx
import aiosqlite
from jose import JWTError, jwt

from app.database import get_db
from app.config import get_settings

router = APIRouter()

SUITE_VERSION = 1
_COOKIE_PROXY_PFX = "pkthub_proxy_"

_IP_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")

_DNS_SIGNALS = (
    "name or service not known",
    "getaddrinfo failed",
    "nodename nor servname provided",
    "name resolution",
    "temporary failure in name resolution",
    "nxdomain",
    "no address associated",
)

_REWRITE_CONTENT_TYPES = {"text/html", "application/xhtml+xml"}

# Never forward these to the upstream pktApp
_STRIP_REQUEST_HEADERS = {
    "host", "authorization", "content-length", "cookie",
    # Strip Accept-Encoding: pktApp must return plain content so the HTML
    # rewriter can operate on readable bytes, not gzip-compressed bytes.
    "accept-encoding",
}

# Never pass these back to the browser from the upstream
_STRIP_RESPONSE_HEADERS = {
    "content-encoding",          # we serve decompressed content
    "transfer-encoding",
    "content-length",            # recalculated by FastAPI after rewriting
    # Remove upstream security headers that conflict with the proxy context
    "content-security-policy",   # upstream CSP can block assets loaded via the proxy
    "x-frame-options",           # would prevent our own iframe embedding
    "x-content-type-options",    # can cause MIME-type blocks on rewritten responses
}


def _is_dns_error(exc: httpx.ConnectError) -> bool:
    combined = (str(exc) + " " + str(getattr(exc, "__cause__", "") or "")).lower()
    return any(sig in combined for sig in _DNS_SIGNALS)


def _extract_encoding(content_type: str) -> str:
    for part in (content_type or "").split(";"):
        part = part.strip()
        if part.lower().startswith("charset="):
            return part[8:].strip().strip('"')
    return "utf-8"


def _should_rewrite_html(content_type: str) -> bool:
    ct = (content_type or "").split(";")[0].strip().lower()
    return ct in _REWRITE_CONTENT_TYPES


def _decompress(content: bytes, content_encoding: str) -> bytes:
    """Safety net — shouldn't fire since we strip Accept-Encoding, but handles
    servers that always gzip regardless."""
    ce = (content_encoding or "").lower()
    if "gzip" in ce:
        try:
            return gzip.decompress(content)
        except Exception:
            pass
    return content


def _rewrite_html(content: bytes, proxy_prefix: str, content_type: str,
                  content_encoding: str = "") -> bytes:
    """
    Rewrite an HTML response so that all asset/API references route through
    the pktHub proxy rather than hitting pktHub's own routes.

    proxy_prefix is either:
      - An absolute URL:  "https://<server-ip>:8760/proxy/5/"  (when return_url is set)
      - A root-relative:  "/proxy/5/"                           (default)

    Steps:
      1. Decompress (safety net).
      2. Inject <base href="{proxy_prefix}"> — fixes bare-relative paths.
         Also inject a fetch/XHR patcher that redirects /api/... calls through
         the proxy path so pktApp SPAs hit their own API, not pktHub's.
      3. Rewrite src="/" href="/" action="/" — absolute paths ignore
         the base tag in browsers, so we must rewrite them explicitly.
      4. Rewrite url("/...") in inline styles.
      5. Strip crossorigin attribute — avoids CORS preflight on proxied modules.
    """
    content = _decompress(content, content_encoding)

    encoding = _extract_encoding(content_type)
    try:
        html = content.decode(encoding, errors="replace")
    except Exception:
        return content

    # Derive root-relative proxy path (e.g. "/proxy/5") for the JS API patcher.
    # proxy_prefix may be a full URL ("https://host/proxy/5/") or path ("/proxy/5/").
    _parsed_pfx = urlparse(proxy_prefix)
    _proxy_path = (_parsed_pfx.path or proxy_prefix).rstrip("/")

    # 1. Inject <base> tag + fetch/XHR patcher into <head>.
    #
    #    Root cause this fixes: pktApp SPAs use root-relative /api/... URLs
    #    (e.g. fetch('/api/users/me')).  When the SPA runs inside the pktHub
    #    proxy iframe the document origin is pktHub, so those calls hit pktHub's
    #    own /api/ endpoints instead of the pktApp's.  pktHub rejects the
    #    pktApp JWT and the SPA falls back to its login page.
    #
    #    Fix: intercept fetch() and XHR.open() before any SPA script runs and
    #    rewrite /api/... → /proxy/{id}/api/... so the call goes through the
    #    proxy and pktHub forwards it to the correct pktApp with X-Suite-Token.
    def _inject_head(m: re.Match) -> str:
        pp = _proxy_path   # root-relative proxy path, e.g. /proxy/5
        pf = proxy_prefix  # full proxy prefix for base href
        script = (
            "<script>"
            "(function(){"
            'var p="' + pp + '";'
            "var _f=window.fetch;"
            "window.fetch=function(u,o){"
            'if(typeof u==="string"&&u.startsWith("/api/"))u=p+u;'
            "return _f.call(this,u,o);};"
            "var _x=XMLHttpRequest.prototype.open;"
            "XMLHttpRequest.prototype.open=function(me,u,a,b,c){"
            'if(typeof u==="string"&&u.startsWith("/api/"))u=p+u;'
            "return _x.call(this,me,u,a,b,c);};"
            "})();"
            "</script>"
            '<base href="' + pf + '">'
        )
        return m.group(1) + script

    html = re.sub(r'(<head[^>]*>)', _inject_head, html, count=1, flags=re.IGNORECASE)

    # 2. Rewrite root-relative src/href/action — double-quoted
    html = re.sub(r'((?:src|href|action|data-src)=")(/(?!/))', rf'\1{proxy_prefix}', html)
    # 2b. Single-quoted variants
    html = re.sub(r"((?:src|href|action|data-src)=')(/(?!/))", rf"\1{proxy_prefix}", html)

    # 3. Rewrite url() in inline styles
    html = re.sub(r"(url\(['\"]?)(/(?!/))", rf"\1{proxy_prefix}", html)

    # 4. Strip crossorigin — prevents CORS preflight for module scripts through proxy
    html = re.sub(r'\s+crossorigin(?:=["\'][^"\']*["\'])?', '', html)

    return html.encode(encoding, errors="replace")


@router.api_route(
    "/proxy/{app_id}/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
async def proxy_request(
    app_id: int,
    path: str,
    request: Request,
    db: aiosqlite.Connection = Depends(get_db),
):
    settings = get_settings()

    # ── 1. Auth: scoped proxy session cookie ─────────────────────────────────
    cookie_name = f"{_COOKIE_PROXY_PFX}{app_id}"
    token = request.cookies.get(cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid proxy session")

    if payload.get("scope") != f"proxy:{app_id}":
        raise HTTPException(status_code=403, detail="Proxy session scoped to a different app")

    username = payload.get("sub")
    role = payload.get("role", "viewer")

    # ── 2. Verify user still active ───────────────────────────────────────────
    async with db.execute(
        "SELECT id FROM users WHERE username = ? AND is_active = 1", (username,)
    ) as cur:
        if not await cur.fetchone():
            raise HTTPException(status_code=401, detail="User is inactive")

    # ── 3. Load target app ────────────────────────────────────────────────────
    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        app = await cur.fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    # ── 4. Build target URL and proxy prefix ──────────────────────────────────
    target_url = f"{app['base_url'].rstrip('/')}/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    parsed_host = urlparse(app["base_url"]).hostname or app["base_url"]

    # proxy_prefix: ALWAYS derived from the browser's Host header so rewritten
    # asset URLs are same-origin for the browser (no CORS issues regardless of
    # whether hostname or IP is used).
    host_header = request.headers.get("host", "")
    scheme = "https" if request.url.scheme == "https" else "http"
    if host_header:
        proxy_prefix = f"{scheme}://{host_header}/proxy/{app_id}/"
    else:
        proxy_prefix = f"/proxy/{app_id}/"

    # Hub URL for pktApp server-side callbacks/redirects back to pktHub.
    # return_url (set in App Registry) is the IP-based URL when the pktApp
    # server cannot resolve the hostname.  Falls back to Host header.
    return_url = (app["return_url"] or "").rstrip("/") if "return_url" in app.keys() else ""
    hub_url = return_url if return_url else (f"{scheme}://{host_header}" if host_header else "")

    # ── 5. Forward — strip accept-encoding so pktApp returns plain content ────
    role_map = {"admin": "admin", "analyst": "analyst", "viewer": "viewer"}
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _STRIP_REQUEST_HEADERS
    }
    headers["X-Suite-Token"]   = app["suite_token"]
    headers["X-Suite-Version"] = str(SUITE_VERSION)
    headers["X-Suite-User"]    = username
    headers["X-Suite-Role"]    = role_map.get(role, "viewer")
    if hub_url:
        headers["X-Suite-Hub-Url"] = hub_url

    body = await request.body()

    # Always skip TLS verification: internal pktApps use self-signed certs.
    # Do NOT follow redirects automatically — we check each one so that
    # external auth redirects (e.g. Okta) never get forwarded to the browser.
    _app_origin = urlparse(app["base_url"]).netloc  # host:port of the pktApp
    async with httpx.AsyncClient(verify=False, timeout=30) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                follow_redirects=False,
            )
            # If the pktApp redirected to an external domain (e.g. an IdP like
            # Okta), intercept it and return a clear error page instead of
            # following the redirect and getting a browser-blocked auth page.
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("location", "")
                loc_netloc = urlparse(location).netloc
                if loc_netloc and loc_netloc != _app_origin:
                    # External redirect — pktApp is trying to send the user to
                    # its own auth provider.  Return a friendly error so the
                    # admin knows to configure suite-token auth on the pktApp.
                    _err_html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>body{{font-family:monospace;background:#0a1628;color:#e5e7eb;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}}
.box{{max-width:480px;padding:2rem;border:1px solid #374151;border-radius:.75rem;
background:#111827}}
h2{{color:#f87171;margin:0 0 .75rem}}p{{margin:.5rem 0;font-size:.85rem;color:#9ca3af}}
code{{color:#60a5fa}}</style></head><body><div class="box">
<h2>Authentication Required</h2>
<p><strong style="color:#e5e7eb">{app["display_name"]}</strong> is redirecting to
an external auth provider (<code>{loc_netloc}</code>) instead of accepting
the pktHub suite token.</p>
<p>To fix this, ensure the pktApp has pktSuite SDK authentication enabled
and the suite token is configured in its settings. Once configured, pktHub
will handle authentication and role pass-through automatically.</p>
<p style="margin-top:1rem;color:#6b7280">Suite token is being sent as
<code>X-Suite-Token</code> with user <code>{username}</code>
(role: <code>{role}</code>).</p>
</div></body></html>"""
                    return Response(
                        content=_err_html.encode(),
                        status_code=502,
                        media_type="text/html",
                        headers={"Cache-Control": "no-store"},
                    )
        except httpx.ConnectError as exc:
            if _is_dns_error(exc):
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"DNS_ERROR: Cannot resolve hostname '{parsed_host}' for "
                        f"{app['display_name']}. The pktHub server has no DNS record "
                        f"for this hostname. Update the registered URL to use an IP "
                        f"address instead, or add '{parsed_host}' to your internal DNS."
                    ),
                )
            raise HTTPException(
                status_code=502,
                detail=(
                    f"CONNECT_ERROR: Cannot reach {app['display_name']} at "
                    f"{parsed_host}. Connection was refused — confirm the app is "
                    f"running and listening on the correct port."
                ),
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail=(
                    f"TIMEOUT: {app['display_name']} did not respond within 30 "
                    f"seconds. The app may be overloaded or unresponsive."
                ),
            )

    # ── 6. Build response, rewriting HTML ─────────────────────────────────────
    content_type = resp.headers.get("content-type", "")
    content_enc  = resp.headers.get("content-encoding", "")
    # Exclude set-cookie from the dict — dicts can't hold duplicate keys,
    # so multi-cookie responses (e.g. sso_access_token + sso_role from pktLog)
    # would lose all but the last.  We forward them separately below.
    response_headers = {
        k: v for k, v in resp.headers.items()
        if k.lower() not in _STRIP_RESPONSE_HEADERS and k.lower() != "set-cookie"
    }

    did_rewrite = False
    if _should_rewrite_html(content_type):
        content = _rewrite_html(resp.content, proxy_prefix, content_type, content_enc)
        did_rewrite = True
    else:
        content = resp.content

    # Debug header so you can confirm rewriting ran (visible in browser DevTools)
    response_headers["X-Pkthub-Rewrote"] = "1" if did_rewrite else "0"
    response_headers["X-Pkthub-Prefix"]  = proxy_prefix

    response_headers["Cache-Control"] = "no-store"

    proxy_response = Response(
        content=content,
        status_code=resp.status_code,
        headers=response_headers,
    )
    # Forward every Set-Cookie header from the pktApp response.
    # This allows pktApps to set their sso_access_token / sso_role cookies
    # (used by pktLog's React SPA to bootstrap auth without showing a login page).
    for cookie_val in resp.headers.get_list("set-cookie"):
        proxy_response.headers.append("set-cookie", cookie_val)
    return proxy_response
