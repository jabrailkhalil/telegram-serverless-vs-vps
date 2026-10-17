import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = fileURLToPath(new URL('../web/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403).end(); return; }
    const file = await readFile(target);
    res.writeHead(200, { 'Content-Type':types[extname(target)] || 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(file);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(8765,'127.0.0.1', () => console.log('Local demo: http://127.0.0.1:8765/?demo=1'));
