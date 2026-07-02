"""Simulate the proxy HTML rewriter on pktLog's actual HTML."""
import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

key = paramiko.RSAKey.from_private_key_file(r'C:\Users\robert.barnett\.ssh\VyneCorpNetInfra.pem')
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('172.23.80.5', username='ec2-user', pkey=key, timeout=15)

def run(cmd, label=""):
    if label: print(f"\n=== {label} ===")
    _, o, e = c.exec_command(cmd, timeout=30)
    out = o.read().decode('utf-8', errors='replace').strip()
    err = e.read().decode('utf-8', errors='replace').strip()
    if out: print(out)
    if err: print("ERR:", err)

# Fetch pktLog HTML and run it through our rewriter
run("""
/mnt/software/pkthub/venv/bin/python3 << 'EOF'
import httpx, re, sqlite3

# Get return_url from DB
db = sqlite3.connect('/mnt/software/pkthub/pkthub.db')
db.row_factory = sqlite3.Row
row = db.execute("SELECT * FROM registered_apps WHERE id = 5").fetchone()
if row:
    return_url = (row['return_url'] or '').rstrip('/') if 'return_url' in row.keys() else ''
    base_url = row['base_url']
    print(f"App base_url: {base_url}")
    print(f"App return_url: {repr(return_url)}")
else:
    print("App not found!")
    exit()
db.close()

proxy_id = 5
if return_url:
    proxy_prefix = f"{return_url}/proxy/{proxy_id}/"
else:
    proxy_prefix = f"/proxy/{proxy_id}/"
print(f"proxy_prefix: {proxy_prefix}")

# Fetch pktLog HTML
resp = httpx.get(base_url.rstrip('/') + '/', verify=False, timeout=10)
html = resp.text

# Apply rewriting
print("\\n--- BEFORE ---")
print(html)

# Inject base tag
html2 = re.sub(r'(<head[^>]*>)', rf'\\1<base href="{proxy_prefix}">', html, count=1, flags=re.IGNORECASE)
# Rewrite root-relative src/href double-quoted
html2 = re.sub(r'((?:src|href|action|data-src)=")(/(?!/))', rf'\\1{proxy_prefix}', html2)
# Single-quoted
html2 = re.sub(r"((?:src|href|action|data-src)=')(/(?!/))", rf"\\1{proxy_prefix}", html2)
# url() in styles
html2 = re.sub(r"(url\\(['\"]?)(/(?!/))", rf"\\1{proxy_prefix}", html2)
# Strip crossorigin
html2 = re.sub(r'\\s+crossorigin(?:=["\'][^"\']*["\'])?', '', html2)

print("\\n--- AFTER ---")
print(html2)
EOF
""", "rewriter simulation")

c.close()
