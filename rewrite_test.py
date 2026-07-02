"""Run on server: simulates proxy HTML rewriter on pktLog's actual HTML."""
import sys
sys.path.insert(0, '/mnt/software/pkthub')
import httpx, re, sqlite3

# Get return_url from DB
db = sqlite3.connect('/mnt/software/pkthub/pkthub.db')
db.row_factory = sqlite3.Row
row = db.execute("SELECT * FROM registered_apps WHERE id = 5").fetchone()
if not row:
    print("App id=5 not found")
    sys.exit(1)

col_names = [d[0] for d in db.execute("SELECT * FROM registered_apps WHERE id = 5").description]
return_url = row['return_url'] if 'return_url' in col_names else ''
return_url = (return_url or '').rstrip('/')
base_url = row['base_url']
print(f"base_url:   {base_url}")
print(f"return_url: {repr(return_url)}")
db.close()

proxy_id = 5
proxy_prefix = f"{return_url}/proxy/{proxy_id}/" if return_url else f"/proxy/{proxy_id}/"
print(f"proxy_prefix: {proxy_prefix}")

# Fetch pktLog HTML
resp = httpx.get(base_url.rstrip('/') + '/', verify=False, timeout=10)
html = resp.text
print("\n--- ORIGINAL HTML ---")
print(html)

# Apply rewriting (same logic as proxy.py)
html2 = re.sub(r'(<head[^>]*>)', rf'\1<base href="{proxy_prefix}">', html, count=1, flags=re.IGNORECASE)
html2 = re.sub(r'((?:src|href|action|data-src)=")(/(?!/))', rf'\1{proxy_prefix}', html2)
html2 = re.sub(r"((?:src|href|action|data-src)=')(/(?!/))", rf"\1{proxy_prefix}", html2)
pat_url = re.compile(r"(url\(['\"]?)(/(?!/))")
html2 = pat_url.sub(rf"\1{proxy_prefix}", html2)
html2 = re.sub(r'\s+crossorigin(?:=["\'][^"\']*["\'])?', '', html2)

print("\n--- REWRITTEN HTML ---")
print(html2)
