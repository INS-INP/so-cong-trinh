// Máy chủ chạy thử trên máy (không cần Cloudflare): node --no-warnings scripts/dev-server.mjs [cổng]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { nodeDb } from '../test/helpers.js';
import { App } from '../src/app.js';

const app = new App(nodeDb(), process.env.TODAY ? { now: () => Date.parse(process.env.TODAY + 'T03:00:00Z') } : {});
const PUB = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await app.handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const p = normalize(join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!p.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(p); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(Number(process.argv[2]) || 8788, () => console.log('http://localhost:' + (Number(process.argv[2]) || 8788)));
