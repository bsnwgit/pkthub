import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\auth.py', 'r', encoding='utf-8') as f:
    src = f.read()

new_endpoint = '''

@router.post("/proxy-session/{app_id}")
async def create_proxy_session(
    app_id: int,
    response: Response,
    current_user: dict = Depends(get_current_user),
):
    """Create a scoped proxy session cookie so the iframe can authenticate with the proxy."""
    settings = get_settings()

    # Short-lived token scoped to this specific app\'s proxy
    token = create_access_token(
        {"sub": current_user["username"], "role": current_user["role"], "scope": f"proxy:{app_id}"},
        expires_delta=timedelta(hours=8),
    )

    response.set_cookie(
        key=f"pkthub_proxy_{app_id}",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        path=f"/proxy/{app_id}/",
        max_age=28800,  # 8 hours
    )
    return {"ok": True}

'''

# Insert before ensure_initial_admin
target = '\nasync def ensure_initial_admin'
assert target in src, "Could not find insertion point"
src = src.replace(target, new_endpoint + 'async def ensure_initial_admin', 1)

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\auth.py', 'w', encoding='utf-8') as f:
    f.write(src)

print("Done - proxy-session endpoint added to auth.py")
