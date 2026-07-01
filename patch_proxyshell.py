import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\frontend\src\pages\ProxyShell.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

old_effect = (
    '  useEffect(() => {\n'
    '    api.listApps().then(apps => {\n'
    '      const found = apps.find(a => String(a.id) === appId)\n'
    '      if (found) setApp(found)\n'
    '    })\n'
    '  }, [appId])\n'
    '\n'
    '  const color = app ? appColor(app.name) : \'#60a5fa\'\n'
    '  const proxyUrl = app ? `/proxy/${appId}/` : null'
)

new_effect = (
    '  useEffect(() => {\n'
    '    api.listApps().then(apps => {\n'
    '      const found = apps.find(a => String(a.id) === appId)\n'
    '      if (!found) return\n'
    '      // Establish proxy session cookie BEFORE creating the iframe.\n'
    '      // Ignore failures — a leftover cookie may already be valid.\n'
    '      api.createProxySession(Number(appId)).catch(() => {}).finally(() => setApp(found))\n'
    '    })\n'
    '  }, [appId])\n'
    '\n'
    '  const color = app ? appColor(app.name) : \'#60a5fa\'\n'
    '  const proxyUrl = app ? `/proxy/${appId}/` : null'
)

assert old_effect in src, "Could not find useEffect block in ProxyShell.tsx"
src = src.replace(old_effect, new_effect)

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\frontend\src\pages\ProxyShell.tsx', 'w', encoding='utf-8') as f:
    f.write(src)

print("Done - ProxyShell.tsx patched")
