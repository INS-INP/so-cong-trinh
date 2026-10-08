// Điểm vào Worker: file giao diện phục vụ từ public/, mọi /api/* chuyển vào 1 Durable Object duy nhất (dữ liệu SQLite, nhất quán tuyệt đối).
import { DurableObject } from 'cloudflare:workers';
import { App } from './app.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function withHeaders(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!h.has(k)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Bộ bọc SQL của Durable Object → giao diện chung (all/one/run/execScript/tx) mà App dùng.
function doDb(storage) {
  const sql = storage.sql;
  const all = (q, ...p) => sql.exec(q, ...p).toArray();
  return {
    all,
    one: (q, ...p) => all(q, ...p)[0] || null,
    run: (q, ...p) => all(q, ...p),
    execScript: (script) => script.split(';').map(s => s.trim()).filter(Boolean).forEach(s => sql.exec(s)),
    tx: (fn) => storage.transactionSync(fn),
  };
}

export class SoCongTrinh extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.app = new App(doDb(ctx.storage));
  }
  async fetch(request) {
    return this.app.handle(request);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const stub = env.SO.get(env.SO.idFromName('so-cong-trinh'));
      return withHeaders(await stub.fetch(request));
    }
    return withHeaders(await env.ASSETS.fetch(request));
  },
};
