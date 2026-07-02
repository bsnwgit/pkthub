import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\proxy.py', 'r', encoding='utf-8') as f:
    src = f.read()

# Replace follow_redirects=True with False and add external-redirect detection
old = (
    '    # Always skip TLS verification: internal pktApps use self-signed certs.\n'
    '    async with httpx.AsyncClient(verify=False, timeout=30) as client:\n'
    '        try:\n'
    '            resp = await client.request(\n'
    '                method=request.method,\n'
    '                url=target_url,\n'
    '                headers=headers,\n'
    '                content=body,\n'
    '                follow_redirects=True,\n'
    '            )'
)

new = (
    '    # Always skip TLS verification: internal pktApps use self-signed certs.\n'
    '    # Do NOT follow redirects automatically — we check each one so that\n'
    '    # external auth redirects (e.g. Okta) never get forwarded to the browser.\n'
    '    _app_origin = urlparse(app["base_url"]).netloc  # host:port of the pktApp\n'
    '    async with httpx.AsyncClient(verify=False, timeout=30) as client:\n'
    '        try:\n'
    '            resp = await client.request(\n'
    '                method=request.method,\n'
    '                url=target_url,\n'
    '                headers=headers,\n'
    '                content=body,\n'
    '                follow_redirects=False,\n'
    '            )\n'
    '            # If the pktApp redirected to an external domain (e.g. an IdP like\n'
    '            # Okta), intercept it and return a clear error page instead of\n'
    '            # following the redirect and getting a browser-blocked auth page.\n'
    '            if resp.status_code in (301, 302, 303, 307, 308):\n'
    '                location = resp.headers.get("location", "")\n'
    '                loc_netloc = urlparse(location).netloc\n'
    '                if loc_netloc and loc_netloc != _app_origin:\n'
    '                    # External redirect — pktApp is trying to send the user to\n'
    '                    # its own auth provider.  Return a friendly error so the\n'
    '                    # admin knows to configure suite-token auth on the pktApp.\n'
    '                    _err_html = f"""<!DOCTYPE html>\n'
    '<html><head><meta charset="utf-8">\n'
    '<style>body{{font-family:monospace;background:#0a1628;color:#e5e7eb;display:flex;\n'
    'align-items:center;justify-content:center;height:100vh;margin:0}}\n'
    '.box{{max-width:480px;padding:2rem;border:1px solid #374151;border-radius:.75rem;\n'
    'background:#111827}}\n'
    'h2{{color:#f87171;margin:0 0 .75rem}}p{{margin:.5rem 0;font-size:.85rem;color:#9ca3af}}\n'
    'code{{color:#60a5fa}}</style></head><body><div class="box">\n'
    '<h2>Authentication Required</h2>\n'
    '<p><strong style="color:#e5e7eb">{app["display_name"]}</strong> is redirecting to\n'
    'an external auth provider (<code>{loc_netloc}</code>) instead of accepting\n'
    'the pktHub suite token.</p>\n'
    '<p>To fix this, ensure the pktApp has pktSuite SDK authentication enabled\n'
    'and the suite token is configured in its settings. Once configured, pktHub\n'
    'will handle authentication and role pass-through automatically.</p>\n'
    '<p style="margin-top:1rem;color:#6b7280">Suite token is being sent as\n'
    '<code>X-Suite-Token</code> with user <code>{username}</code>\n'
    '(role: <code>{role}</code>).</p>\n'
    '</div></body></html>"""\n'
    '                    return Response(\n'
    '                        content=_err_html.encode(),\n'
    '                        status_code=502,\n'
    '                        media_type="text/html",\n'
    '                        headers={"Cache-Control": "no-store"},\n'
    '                    )'
)

assert old in src, "Could not find follow_redirects block"
src = src.replace(old, new)

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\app\proxy.py', 'w', encoding='utf-8') as f:
    f.write(src)

print("Done")
