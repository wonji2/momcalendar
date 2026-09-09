// 로컬 확인용 정적 서버 (test.html 검증). 포트 8788.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(b);
  } catch { res.writeHead(404).end('not found'); }
}).listen(8788, () => console.log('dev server on http://localhost:8788'));
