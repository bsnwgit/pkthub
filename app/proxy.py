from fastapi import APIRouter, Request, Response, Depends, HTTPException
from fastapi.responses import StreamingResponse
import httpx
import aiosqlite
import json
from app.database import get_db
from app.auth import get_current_user

router = APIRouter()

SUITE_VERSION = 1

@router.api_route("/proxy/{app_id}/{path:path}", methods=["GET","POST","PUT","PATCH","DELETE","OPTIONS"])
async def proxy_request(
    app_id: int,
    path: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db)
):
    async with db.execute("SELECT * FROM registered_apps WHERE id = ?", (app_id,)) as cur:
        app = await cur.fetchone()
    if not app:
        raise HTTPException(status_code=404, detail="App not found")

    # Map pktSuite role to pktXXXX role (1:1 mapping)
    role_map = {"admin": "admin", "analyst": "analyst", "viewer": "viewer"}
    mapped_role = role_map.get(current_user["role"], "viewer")

    target_url = f"{app['base_url'].rstrip('/')}/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    # Forward headers, inject suite token and version
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "authorization", "content-length")
    }
    headers["X-Suite-Token"] = app["suite_token"]
    headers["X-Suite-Version"] = str(SUITE_VERSION)
    headers["X-Suite-User"] = current_user["username"]
    headers["X-Suite-Role"] = mapped_role

    body = await request.body()

    async with httpx.AsyncClient(verify=False, timeout=30) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
            )
        except httpx.ConnectError:
            raise HTTPException(status_code=502, detail=f"Cannot reach {app['display_name']}")
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"Timeout reaching {app['display_name']}")

    # Stream response back
    excluded = {"content-encoding", "transfer-encoding", "content-length"}
    response_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=response_headers,
        media_type=resp.headers.get("content-type"),
    )
