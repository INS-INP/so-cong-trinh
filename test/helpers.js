// Chạy App trên SQLite của Node (giống SQLite trong Durable Object) để kiểm thử toàn bộ API.
import { DatabaseSync } from 'node:sqlite';
import { App } from '../src/app.js';

export function nodeDb() {
  const db = new DatabaseSync(':memory:');
  const norm = (p) => p.map(v => (v === undefined ? null : v));
  const all = (q, ...p) => db.prepare(q).all(...norm(p)).map(r => ({ ...r }));
  return {
    all,
    one: (q, ...p) => all(q, ...p)[0] || null,
    run: (q, ...p) => all(q, ...p),
    execScript: (s) => db.exec(s),
    tx: (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}

export function makeEnv(today = '2026-10-15') {
  let now = Date.parse(today + 'T03:00:00Z');
  const app = new App(nodeDb(), { now: () => now });
  const setToday = (d) => { now = Date.parse(d + 'T03:00:00Z'); };
  async function call(method, path, body, cookie, extraHeaders = {}) {
    const headers = { 'content-type': 'application/json', ...extraHeaders };
    if (method !== 'GET' && !('x-sct' in extraHeaders)) headers['x-sct'] = '1';
    if (cookie) headers.cookie = cookie;
    const res = await app.handle(new Request('https://so.test' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }));
    const setCookie = res.headers.get('set-cookie');
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
    return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : null, headers: res.headers };
  }
  return { app, call, setToday };
}

export const FILE = [{ name: 'hd.jpg', mime: 'image/jpeg', data: Buffer.from('anh-hoa-don').toString('base64') }];

export async function bootstrap(env) {
  const r = await env.call('POST', '/api/setup', {
    company_name: 'CÔNG TY TNHH THI CÔNG THỬ', company_mst: '0100000001', company_address: 'Thanh Hoá',
    admin_username: 'admin', admin_full_name: 'Quản trị', admin_password: 'matkhau123',
    shareholders: [{ name: 'Cổ đông A', pct: 60 }, { name: 'Cổ đông B', pct: 40 }],
  });
  const admin = r.cookie;
  const mk = async (username, role) => {
    await env.call('POST', '/api/users', { username, full_name: username, role, password: 'matkhau123' }, admin);
    return (await env.call('POST', '/api/login', { username, password: 'matkhau123' })).cookie;
  };
  return { admin, ketoan: await mk('ketoan', 'ke_toan'), chihuy: await mk('chihuy', 'chi_huy'), codong: await mk('codong', 'co_dong') };
}
