import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\proxy.py', 'r', encoding='utf-8') as f:
    src = f.read()

# Fix 1: proxy_prefix ALWAYS from Host header (never from return_url)
# return_url is now ONLY for X-Suite-Hub-Url header to pktApps
old_prefix = (
    '    # proxy_prefix must match what the *browser* uses to reach pktHub so that\n'
    '    # rewritten asset URLs resolve same-origin (no CORS issues).\n'
    '    # Priority: 1) return_url override  2) Host header  3) root-relative fallback\n'
    '    return_url = (app["return_url"] or "").rstrip("/") if "return_url" in app.keys() else ""\n'
    '    if return_url:\n'
    '        proxy_prefix = f"{return_url}/proxy/{app_id}/"\n'
    '    else:\n'
    '        host_header = request.headers.get("host", "")\n'
    '        if host_header:\n'
    '            scheme = "https" if request.url.scheme == "https" else "http"\n'
    '            proxy_prefix = f"{scheme}://{host_header}/proxy/{app_id}/"\n'
    '        else:\n'
    '            proxy_prefix = f"/proxy/{app_id}/"'
)

new_prefix = (
    '    # proxy_prefix: ALWAYS derived from the browser\'s Host header so rewritten\n'
    '    # asset URLs are same-origin for the browser (no CORS issues regardless of\n'
    '    # whether hostname or IP is used).\n'
    '    host_header = request.headers.get("host", "")\n'
    '    scheme = "https" if request.url.scheme == "https" else "http"\n'
    '    if host_header:\n'
    '        proxy_prefix = f"{scheme}://{host_header}/proxy/{app_id}/"\n'
    '    else:\n'
    '        proxy_prefix = f"/proxy/{app_id}/"\n'
    '\n'
    '    # Hub URL for pktApp server-side callbacks/redirects back to pktHub.\n'
    '    # return_url (set in App Registry) is the IP-based URL when the pktApp\n'
    '    # server cannot resolve the hostname.  Falls back to Host header.\n'
    '    return_url = (app["return_url"] or "").rstrip("/") if "return_url" in app.keys() else ""\n'
    '    hub_url = return_url if return_url else (f"{scheme}://{host_header}" if host_header else "")'
)

assert old_prefix in src, "Could not find proxy_prefix block"
src = src.replace(old_prefix, new_prefix)
print("Fixed proxy_prefix block")

# Fix 2: add X-Suite-Hub-Url to headers sent to pktApp
old_headers = (
    '    headers["X-Suite-Token"]   = app["suite_token"]\n'
    '    headers["X-Suite-Version"] = str(SUITE_VERSION)\n'
    '    headers["X-Suite-User"]    = username\n'
    '    headers["X-Suite-Role"]    = role_map.get(role, "viewer")'
)

new_headers = (
    '    headers["X-Suite-Token"]   = app["suite_token"]\n'
    '    headers["X-Suite-Version"] = str(SUITE_VERSION)\n'
    '    headers["X-Suite-User"]    = username\n'
    '    headers["X-Suite-Role"]    = role_map.get(role, "viewer")\n'
    '    if hub_url:\n'
    '        headers["X-Suite-Hub-Url"] = hub_url'
)

assert old_headers in src, "Could not find headers block"
src = src.replace(old_headers, new_headers)
print("Added X-Suite-Hub-Url header")

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\proxy.py', 'w', encoding='utf-8') as f:
    f.write(src)

print("Done")
