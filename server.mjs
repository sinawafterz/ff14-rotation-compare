// 手元で試すための簡易サーバー(docs/ を配るだけ)
// 公開版(GitHub Pages)ではこのファイルは使わない。データの取得はすべてブラウザ側(docs/data.js)で行う。
// 起動: node server.mjs → http://localhost:5173/
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs');
const PORT = Number(process.env.PORT || 5173);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname.endsWith('/') ? u.pathname + 'index.html' : u.pathname;
  const file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`スキル回し比較ツール: http://localhost:${PORT}/`));
