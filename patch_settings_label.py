import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\frontend\src\pages\SettingsPage.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

old = (
    '                <label className="block text-xs text-gray-400 mb-1">Hub Return URL <span className="text-gray-600">(optional)</span></label>\n'
    '                <input value={form.return_url} onChange={e => setForm(f => ({ ...f, return_url: e.target.value }))}\n'
    '                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white font-mono focus:outline-none focus:border-blue-500"\n'
    '                  placeholder="https://172.23.80.5:8760  — set if pkthub hostname doesn\'t resolve on the server" />'
)

new = (
    '                <label className="block text-xs text-gray-400 mb-1">\n'
    '                  Hub Return URL <span className="text-gray-600">(optional — only set if the app server cannot resolve the pktHub hostname; use IP-based URL)</span>\n'
    '                </label>\n'
    '                <input value={form.return_url} onChange={e => setForm(f => ({ ...f, return_url: e.target.value }))}\n'
    '                  className="w-full px-3 py-2 rounded-lg text-sm bg-gray-800 border border-gray-700 text-white font-mono focus:outline-none focus:border-blue-500"\n'
    '                  placeholder="Leave blank unless DNS issues — e.g. https://172.23.80.5:8760" />'
)

assert old in src, "Could not find label block"
src = src.replace(old, new)

with open(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub\frontend\src\pages\SettingsPage.tsx', 'w', encoding='utf-8') as f:
    f.write(src)

print("Done")
