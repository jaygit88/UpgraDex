# Packs a static site folder into a Cloudflare Worker that serves it (deduplicating identical files).
# The files are built into the worker itself. Usage: python3 scripts/pack-site.py <site folder> <output folder>
import os, sys, hashlib, json, shutil
site, out = sys.argv[1], sys.argv[2]
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8',
         '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8'}
TEXT = {'.html', '.js', '.css', '.json', '.webmanifest', '.md', '.svg', '.txt'}
shutil.rmtree(out, ignore_errors=True); os.makedirs(f'{out}/files')
routes, imports, seen = {}, [], {}
for root, _, files in os.walk(site):
    for f in sorted(files):
        p = os.path.join(root, f); ext = os.path.splitext(f)[1].lower()
        if ext not in TYPES: continue
        b = open(p, 'rb').read(); h = hashlib.sha1(b).hexdigest()[:16]
        if h not in seen:
            name = f'{h}.{"txt" if ext in TEXT else "bin"}'
            open(f'{out}/files/{name}', 'wb').write(b)
            seen[h] = f'f{len(seen)}'; imports.append(f"import {seen[h]} from './files/{name}';")
        url = '/' + os.path.relpath(p, site).replace(os.sep, '/')
        routes[url] = [seen[h], TYPES[ext]]
worker = '\n'.join(imports) + f"""

const ROUTES = {{ {', '.join(f'{json.dumps(k)}: [{v[0]}, {json.dumps(v[1])}]' for k, v in sorted(routes.items()))} }};

export default {{
  async fetch(request) {{
    const url = new URL(request.url);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    let hit = ROUTES[path];
    if (!hit && ROUTES[path + '/index.html']) return Response.redirect(url.origin + url.pathname + '/' + url.search, 301);
    if (!hit) return new Response('Not found', {{ status: 404, headers: {{ 'content-type': 'text/plain' }} }});
    const [body, type] = hit;
    const longCache = /^image\\//.test(type);
    return new Response(body, {{ headers: {{ 'content-type': type, 'cache-control': longCache ? 'public, max-age=86400' : 'public, max-age=0, must-revalidate' }} }});
  }},
}};
"""
open(f'{out}/worker.js', 'w').write(worker)
open(f'{out}/wrangler.toml', 'w').write('''name = "upgradex"
main = "worker.js"
compatibility_date = "2025-09-01"
# Serves UpgraDex: the real app under /app/, UpgraDex Test under /test/.
rules = [
  { type = "Text", globs = ["**/*.txt"], fallthrough = false },
  { type = "Data", globs = ["**/*.bin"], fallthrough = false },
]
''')
print(len(routes), 'paths,', len(seen), 'unique files')
