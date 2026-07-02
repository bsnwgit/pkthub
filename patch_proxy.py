import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\proxy.py', 'r', encoding='utf-8') as f:
    src = f.read()

old_prefix = ('    # proxy_prefix: absolute if admin set a return_url, otherwise root-relative.\n'
              '    # The return_url is pktHub\'s own URL as the browser sees it (e.g. an IP\n'
              '    # address when the hub hostname doesn\'t resolve on the server\'s DNS).\n'
              '    return_url = (app["return_url"] or "").rstrip("/") if "return_url" in app.keys() else ""\n'
              '    if return_url:\n'
              '        proxy_prefix = f"{return_url}/proxy/{app_id}/"\n'
              '    else:\n'
              '        proxy_prefix = f"/proxy/{app_id}/"')

new_prefix = ('    # proxy_prefix must match what the *browser* uses to reach pktHub so that\n'
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
              '            proxy_prefix = f"/proxy/{app_id}/"')

assert old_prefix in src, "Could not find proxy_prefix block"
src = src.replace(old_prefix, new_prefix)

old_return = ('    return Response(\n'
              '        content=content,\n'
              '        status_code=resp.status_code,\n'
              '        headers=response_headers,\n'
              '    )')

new_return = ('    response_headers["Cache-Control"] = "no-store"\n\n'
              '    return Response(\n'
              '        content=content,\n'
              '        status_code=resp.status_code,\n'
              '        headers=response_headers,\n'
              '    )')

assert old_return in src, "Could not find return Response block"
src = src.replace(old_return, new_return)

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\proxy.py', 'w', encoding='utf-8') as f:
    f.write(src)

print("Done - proxy.py patched")
