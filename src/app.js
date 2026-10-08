// API của Sổ Công Trình. Nhận `db` (bộ bọc SQLite) để chạy được cả trong Durable Object lẫn bộ kiểm thử.
import { migrate } from './schema.js';
import {
  ROLES, PROJECT_CATEGORIES, OVERHEAD_CATEGORIES, CATEGORIES, PAY_METHODS, CASH_METHODS, PROJECT_STATUS,
  COST_STATUS, PARTNER_KIND, DEFAULT_SETTINGS, ADVANCE_KIND,
} from './constants.js';
import { ACCOUNTS, MANUAL_ACCOUNTS, OPENING_ACCOUNTS, EVIDENCE } from './accounts.js';
import {
  HttpError, bad, vnNow, vnToday, isDate, isMonth, monthOf, nextMonth, monthEnd, toMoney, str, oneOf,
  b64ToBytes, sha256Hex,
} from './util.js';
import { hashPassword, verifyPassword, checkPasswordStrength, randomHex, tokenHash } from './auth.js';
import { monthlyReport, projectsSummary, journal, balances, insolarReconcile, trialBalance, ledger, taxReport, advanceBalances, vatBlocked } from './report.js';
import { parseEInvoice } from '../public/einvoice.js';

const SESSION_DAYS = 30;
const MAX_ATTACH = 1900 * 1024; // giới hạn 1 dòng SQLite của Durable Object là 2MB
const MAX_ATTACH_PER_REQ = 6;
const ATTACH_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf|application\/xml|text\/xml)$/;
const APPROVERS = ['quan_tri', 'ke_toan', 'co_dong'];
const BOOKKEEPERS = ['quan_tri', 'ke_toan'];
const VIEWERS = ['quan_tri', 'ke_toan', 'co_dong'];

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

// Dấu vân tay số liệu (chỉ con số, không gồm tên/cài đặt) để phát hiện dữ liệu của tháng đã khoá bị thay đổi.
function fingerprint(rep) {
  return {
    projects: rep.projects.map(r => [r.id, r.kind, r.month, r.to_date, r.result]),
    overhead: rep.overhead, completed_gross: rep.completed_gross, adjustments: rep.adjustments, wip: rep.wip,
    revenue: rep.totals.revenue, cost: rep.totals.cost, receipts: rep.totals.receipts, payments: rep.totals.payments,
    manual: [rep.overhead_manual || 0, rep.other_income || 0, rep.other_expense || 0, rep.cit || 0],
  };
}

// Tên máy dễ đọc từ User-Agent (để người dùng nhận ra phiên đăng nhập của mình).
function deviceName(request) {
  const ua = request.headers.get('user-agent') || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Máy khác';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

// Phiên bản bản ghi: người sửa gửi kèm phiên bản đang thấy; nếu đã có người khác sửa trước → từ chối, không ghi đè.
function checkVersion(body, current, what = 'Dữ liệu') {
  if (body.version === undefined || body.version === null || body.version === '') return;
  if (Number(body.version) !== Number(current)) {
    const e = new HttpError(409, `${what} vừa được người khác sửa. Đã tải lại bản mới nhất, vui lòng kiểm tra rồi làm lại.`);
    e.code = 'conflict';
    throw e;
  }
}
function dupError(msg) { const e = new HttpError(409, msg); e.code = 'possible_duplicate'; return e; }

export class App {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
    migrate(db);
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, k, v);
    }
  }

  // ---------- tiện ích dữ liệu ----------
  settings() {
    const s = {};
    this.db.all(`SELECT key, value FROM settings`).forEach(r => { s[r.key] = r.value; });
    return s;
  }
  setSetting(k, v) { this.db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, String(v)); }
  nextCode(prefix) {
    const r = this.db.one(`INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`, prefix);
    return `${prefix}-${String(r.value).padStart(6, '0')}`;
  }
  audit(user, action, entity, id, before, after, ip = '') {
    this.db.run(`INSERT INTO audit (at, user_id, action, entity, entity_id, before_json, after_json, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      vnNow(this.now()), user ? user.id : null, action, entity, String(id ?? ''),
      before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '', ip);
  }
  today() { return vnToday(this.now()); }
  assertOpen(date) {
    const lt = this.settings().locked_through;
    if (lt && monthOf(date) <= lt) throw bad(`Tháng ${monthOf(date)} đã khoá sổ. Chỉ được ghi bút toán điều chỉnh vào tháng chưa khoá.`);
  }
  assertDate(date, field = 'Ngày') {
    if (!isDate(date)) throw bad(`${field} không hợp lệ`);
    if (date > this.today()) throw bad(`${field} không được sau hôm nay`);
    if (date < '2000-01-01') throw bad(`${field} không hợp lệ`);
  }
  need(user, roles) {
    if (!roles.includes(user.role)) throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này');
  }

  // ---------- phiên đăng nhập ----------
  async currentUser(request) {
    const m = /(?:^|;\s*)sct=([a-f0-9]{64})/.exec(request.headers.get('cookie') || '');
    if (!m) return null;
    const h = await tokenHash(m[1]);
    const s = this.db.one(`SELECT user_id, expires_at, last_seen FROM sessions WHERE token_hash = ?`, h);
    if (!s || s.expires_at < this.now()) return null;
    const u = this.db.one(`SELECT id, username, full_name, role, active FROM users WHERE id = ?`, s.user_id);
    if (!u || !u.active) return null;
    if (this.now() - s.last_seen > 60000) this.db.run(`UPDATE sessions SET last_seen = ? WHERE token_hash = ?`, this.now(), h);
    u.session = h;
    return u;
  }
  async mySessions({ user }) {
    return { items: this.db.all(`SELECT token_hash, device, created_at, last_seen FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC`, user.id, this.now())
      .map(x => ({ current: x.token_hash === user.session, device: x.device, created_at: vnNow(x.created_at), last_seen: x.last_seen ? vnNow(x.last_seen) : '' })) };
  }
  async logoutOthers({ user, ip }) {
    const n = this.db.all(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ? RETURNING token_hash`, user.id, user.session).length;
    this.audit(user, 'dang_xuat_may_khac', 'nguoi_dung', user.id, null, { so_phien: n }, ip);
    return { ok: true, count: n };
  }
  async newSession(userId, device = '') {
    const token = randomHex(32);
    const now = this.now();
    this.db.run(`DELETE FROM sessions WHERE expires_at < ?`, now);
    this.db.run(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, device, last_seen) VALUES (?, ?, ?, ?, ?, ?)`,
      await tokenHash(token), userId, now, now + SESSION_DAYS * 86400000, String(device).slice(0, 200), now);
    return `sct=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
  }

  // ---------- định tuyến ----------
  async handle(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const method = request.method;
    const ip = request.headers.get('cf-connecting-ip') || '';
    try {
      if (method !== 'GET' && request.headers.get('x-sct') !== '1') throw new HttpError(403, 'Yêu cầu không hợp lệ');
      let body = {};
      if (method !== 'GET') {
        const len = Number(request.headers.get('content-length') || 0);
        if (len > 16 * 1024 * 1024) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn');
        const text = await request.text();
        if (text.length > 16 * 1024 * 1024) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn');
        try { body = text ? JSON.parse(text) : {}; } catch { throw bad('Dữ liệu gửi lên không phải JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Dữ liệu gửi lên không hợp lệ');
      }
      const q = Object.fromEntries(url.searchParams);
      const ctx = { request, body, q, ip };

      if (path === '/api/status' && method === 'GET') return json({ setup_done: this.userCount() > 0, today: this.today() });
      if (path === '/api/setup' && method === 'POST') return await this.setup(ctx);
      if (path === '/api/login' && method === 'POST') return await this.login(ctx);

      const user = await this.currentUser(request);
      if (!user) throw new HttpError(401, 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại');
      ctx.user = user;

      // Chống gửi trùng: mỗi thao tác ghi mang 1 mã (x-idem). Bấm 2 lần, mạng chập chờn gửi lại, hay 2 máy cùng
      // tài khoản gửi cùng mã → chỉ thực hiện 1 lần, lần sau nhận lại đúng kết quả lần đầu.
      const idem = method !== 'GET' ? (request.headers.get('x-idem') || '') : '';
      if (idem) {
        if (!/^[A-Za-z0-9_-]{8,80}$/.test(idem)) throw bad('Mã chống trùng không hợp lệ');
        const hit = this.db.one(`SELECT user_id, status, body FROM idempotency WHERE key = ?`, idem);
        if (hit) {
          if (hit.user_id !== user.id || hit.status === 0) throw new HttpError(409, 'Thao tác này đang được xử lý, vui lòng đợi');
          return new Response(hit.body, { status: hit.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-idem-replay': '1' } });
        }
        this.db.run(`INSERT INTO idempotency (key, user_id, status, body, at) VALUES (?, ?, 0, '', ?)`, idem, user.id, this.now());
        let res;
        try { res = await this.dispatch(ctx, path, method); } catch (e) { this.db.run(`DELETE FROM idempotency WHERE key = ?`, idem); throw e; }
        if (res.status < 300 && !res.headers.get('set-cookie')) {
          const text = await res.clone().text();
          this.db.run(`UPDATE idempotency SET status = ?, body = ? WHERE key = ?`, res.status, text.slice(0, 20000), idem);
        } else this.db.run(`DELETE FROM idempotency WHERE key = ?`, idem);
        if (Math.random() < 0.05) this.db.run(`DELETE FROM idempotency WHERE at < ?`, this.now() - 2 * 86400000);
        return res;
      }
      return await this.dispatch(ctx, path, method);
    } catch (e) {
      return this.errorResponse(e);
    }
  }

  errorResponse(e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
    if (/UNIQUE constraint failed: costs\.einvoice_key/.test(String(e && e.message))) return json({ error: 'Hoá đơn này đã được nhập trước đó.' }, 409);
    if (/UNIQUE constraint failed/.test(String(e && e.message))) return json({ error: 'Dữ liệu bị trùng (mã hoặc tên đăng nhập đã tồn tại).' }, 409);
    console.error(e);
    return json({ error: 'Lỗi hệ thống. Vui lòng thử lại.' }, 500);
  }

  async dispatch(ctx, path, method) {
    const user = ctx.user;
    try {

      if (path === '/api/logout' && method === 'POST') return await this.logout(ctx);
      if (path === '/api/bootstrap' && method === 'GET') return json(this.bootstrap(user));
      if (path === '/api/me/password' && method === 'POST') return await this.changeOwnPassword(ctx);
      if (path === '/api/me/sessions' && method === 'GET') return json(await this.mySessions(ctx));
      if (path === '/api/me/logout-others' && method === 'POST') return json(await this.logoutOthers(ctx));
      if (path === '/api/changes' && method === 'GET') return json({ seq: Number(this.db.one(`SELECT COALESCE(MAX(id), 0) AS n FROM audit WHERE action NOT IN ('dang_nhap', 'dang_nhap_sai')`).n) });

      const routes = [
        ['GET', /^\/api\/dashboard$/, () => this.dashboard(ctx)],
        ['POST', /^\/api\/users$/, () => this.createUser(ctx)],
        ['PUT', /^\/api\/users\/(\d+)$/, (id) => this.updateUser(ctx, +id)],
        ['POST', /^\/api\/users\/(\d+)\/password$/, (id) => this.resetPassword(ctx, +id)],
        ['PUT', /^\/api\/settings$/, () => this.updateSettings(ctx)],
        ['PUT', /^\/api\/shareholders$/, () => this.updateShareholders(ctx)],
        ['POST', /^\/api\/partners$/, () => this.savePartner(ctx, null)],
        ['PUT', /^\/api\/partners\/(\d+)$/, (id) => this.savePartner(ctx, +id)],
        ['POST', /^\/api\/projects$/, () => this.saveProject(ctx, null)],
        ['PUT', /^\/api\/projects\/(\d+)$/, (id) => this.saveProject(ctx, +id)],
        ['POST', /^\/api\/projects\/(\d+)\/accept$/, (id) => this.acceptProject(ctx, +id)],
        ['POST', /^\/api\/projects\/(\d+)\/reopen$/, (id) => this.reopenProject(ctx, +id)],
        ['GET', /^\/api\/costs$/, () => this.listCosts(ctx)],
        ['GET', /^\/api\/costs\/(\d+)$/, (id) => this.getCost(ctx, +id)],
        ['POST', /^\/api\/costs$/, () => this.createCost(ctx)],
        ['POST', /^\/api\/costs\/einvoice-preview$/, () => this.previewEInvoice(ctx)],
        ['POST', /^\/api\/costs\/einvoice$/, () => this.importEInvoice(ctx)],
        ['PUT', /^\/api\/costs\/(\d+)$/, (id) => this.updateCost(ctx, +id)],
        ['POST', /^\/api\/costs\/(\d+)\/approve$/, (id) => this.approveCost(ctx, +id)],
        ['POST', /^\/api\/costs\/(\d+)\/reject$/, (id) => this.rejectCost(ctx, +id)],
        ['POST', /^\/api\/costs\/(\d+)\/void$/, (id) => this.voidEntry(ctx, 'costs', +id)],
        ['GET', /^\/api\/(revenues|receipts|payments)$/, (t) => this.listLedger(ctx, t)],
        ['POST', /^\/api\/(revenues|receipts|payments)$/, (t) => this.createLedger(ctx, t)],
        ['POST', /^\/api\/(revenues|receipts|payments)\/(\d+)\/void$/, (t, id) => this.voidEntry(ctx, t, +id)],
        ['PUT', /^\/api\/projects\/(\d+)\/budget$/, (id) => this.saveBudget(ctx, +id)],
        ['GET', /^\/api\/advances$/, () => this.listAdvances(ctx)],
        ['POST', /^\/api\/advances$/, () => this.createAdvance(ctx)],
        ['POST', /^\/api\/advances\/(\d+)\/void$/, (id) => this.voidEntry(ctx, 'advances', +id)],
        ['GET', /^\/api\/journals$/, () => this.listJournals(ctx)],
        ['POST', /^\/api\/journals$/, () => this.createJournal(ctx)],
        ['POST', /^\/api\/journals\/(\d+)\/void$/, (id) => this.voidEntry(ctx, 'journals', +id)],
        ['GET', /^\/api\/report\/trial$/, () => this.reportTrial(ctx)],
        ['GET', /^\/api\/report\/ledger$/, () => this.reportLedger(ctx)],
        ['GET', /^\/api\/report\/tax$/, () => this.reportTax(ctx)],
        ['GET', /^\/api\/attachments$/, () => this.listAttachments(ctx)],
        ['POST', /^\/api\/attachments$/, () => this.addAttachments(ctx)],
        ['GET', /^\/api\/attachments\/(\d+)$/, (id) => this.getAttachment(ctx, +id)],
        ['GET', /^\/api\/report\/month$/, () => this.reportMonth(ctx)],
        ['GET', /^\/api\/report\/projects$/, () => this.reportProjects(ctx)],
        ['GET', /^\/api\/report\/journal$/, () => this.reportJournal(ctx)],
        ['GET', /^\/api\/report\/balances$/, () => this.reportBalances(ctx)],
        ['GET', /^\/api\/locks$/, () => this.listLocks(ctx)],
        ['POST', /^\/api\/locks$/, () => this.lockMonth(ctx)],
        ['POST', /^\/api\/signoffs$/, () => this.signoff(ctx)],
        ['GET', /^\/api\/audit$/, () => this.listAudit(ctx)],
      ];
      for (const [m, re, fn] of routes) {
        if (m !== method) continue;
        const mm = re.exec(path);
        if (mm) {
          const r = await fn(...mm.slice(1));
          return r instanceof Response ? r : json(r);
        }
      }
      throw new HttpError(404, 'Không tìm thấy');
    } catch (e) {
      return this.errorResponse(e);
    }
  }

  userCount() { return Number(this.db.one(`SELECT COUNT(*) AS n FROM users`).n); }

  // ---------- thiết lập lần đầu / đăng nhập ----------
  async setup({ body, ip }) {
    if (this.userCount() > 0) throw new HttpError(403, 'Phần mềm đã được thiết lập');
    const company = str(body.company_name, { field: 'tên công ty', required: true, max: 200 });
    const username = this.cleanUsername(body.admin_username);
    const fullName = str(body.admin_full_name, { field: 'họ tên', required: true, max: 100 });
    const pwErr = checkPasswordStrength(body.admin_password);
    if (pwErr) throw bad(pwErr);
    const { hash, salt } = await hashPassword(body.admin_password);
    const shareholders = this.validShareholders(body.shareholders || []);
    let userId;
    this.db.tx(() => {
      this.setSetting('company_name', company);
      this.setSetting('company_mst', str(body.company_mst, { field: 'MST', max: 20 }));
      this.setSetting('company_address', str(body.company_address, { field: 'địa chỉ', max: 300 }));
      userId = this.db.one(`INSERT INTO users (username, full_name, role, pass_hash, pass_salt, created_at) VALUES (?, ?, 'quan_tri', ?, ?, ?) RETURNING id`,
        username, fullName, hash, salt, vnNow(this.now())).id;
      shareholders.forEach(s => this.db.run(`INSERT INTO shareholders (name, pct_bp, note) VALUES (?, ?, ?)`, s.name, s.pct_bp, s.note));
      this.audit({ id: userId }, 'thiet_lap', 'he_thong', '', null, { company, username, shareholders }, ip);
    });
    return json({ ok: true }, 200, { 'set-cookie': await this.newSession(userId) });
  }

  cleanUsername(v) {
    const u = str(v, { field: 'tên đăng nhập', required: true, max: 40 }).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw bad('Tên đăng nhập chỉ gồm chữ không dấu, số, dấu chấm/gạch (3–40 ký tự)');
    return u;
  }

  async login({ body, ip, request }) {
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const u = this.db.one(`SELECT * FROM users WHERE username = ?`, username);
    const now = this.now();
    if (u && u.locked_until > now) throw new HttpError(429, 'Tài khoản tạm khoá 15 phút do nhập sai mật khẩu nhiều lần');
    const ok = u ? await verifyPassword(password, u.pass_hash, u.pass_salt) : (await hashPassword(password), false);
    if (!u || !ok || !u.active) {
      if (u) {
        const fails = u.fail_count + 1;
        this.db.run(`UPDATE users SET fail_count = ?, locked_until = ? WHERE id = ?`, fails >= 5 ? 0 : fails, fails >= 5 ? now + 15 * 60000 : 0, u.id);
        this.audit(u, 'dang_nhap_sai', 'nguoi_dung', u.id, null, null, ip);
      }
      throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
    }
    this.db.run(`UPDATE users SET fail_count = 0, locked_until = 0 WHERE id = ?`, u.id);
    this.audit(u, 'dang_nhap', 'nguoi_dung', u.id, null, null, ip);
    return json({ ok: true }, 200, { 'set-cookie': await this.newSession(u.id, deviceName(request)) });
  }

  async logout({ request }) {
    const m = /(?:^|;\s*)sct=([a-f0-9]{64})/.exec(request.headers.get('cookie') || '');
    if (m) this.db.run(`DELETE FROM sessions WHERE token_hash = ?`, await tokenHash(m[1]));
    return json({ ok: true }, 200, { 'set-cookie': 'sct=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }

  async changeOwnPassword({ user, body, ip }) {
    const u = this.db.one(`SELECT * FROM users WHERE id = ?`, user.id);
    if (!(await verifyPassword(String(body.old_password || ''), u.pass_hash, u.pass_salt))) throw bad('Mật khẩu cũ không đúng');
    const err = checkPasswordStrength(body.new_password);
    if (err) throw bad(err);
    const { hash, salt } = await hashPassword(body.new_password);
    this.db.run(`UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?`, hash, salt, user.id);
    this.db.run(`DELETE FROM sessions WHERE user_id = ?`, user.id);
    this.audit(user, 'doi_mat_khau', 'nguoi_dung', user.id, null, null, ip);
    return json({ ok: true }, 200, { 'set-cookie': await this.newSession(user.id) });
  }

  bootstrap(user) {
    const s = this.settings();
    const isChiHuy = user.role === 'chi_huy';
    return {
      me: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
      today: this.today(),
      settings: s,
      constants: { ROLES, PROJECT_CATEGORIES, OVERHEAD_CATEGORIES, CATEGORIES, PAY_METHODS, CASH_METHODS, PROJECT_STATUS, COST_STATUS, PARTNER_KIND, ADVANCE_KIND, ACCOUNTS, MANUAL_ACCOUNTS, OPENING_ACCOUNTS, EVIDENCE },
      users: this.db.all(`SELECT id, username, full_name, role, active, version FROM users ORDER BY id`),
      shareholders: isChiHuy ? [] : this.db.all(`SELECT id, name, pct_bp, note FROM shareholders ORDER BY id`),
      partners: this.db.all(`SELECT * FROM partners ORDER BY name`),
      projects: this.db.all(`SELECT * FROM projects ORDER BY id DESC`).map(p => (isChiHuy ? { ...p, contract_value: 0 } : p)),
    };
  }

  // ---------- người dùng ----------
  async createUser({ user, body, ip }) {
    this.need(user, ['quan_tri']);
    const username = this.cleanUsername(body.username);
    const fullName = str(body.full_name, { field: 'họ tên', required: true, max: 100 });
    const role = oneOf(body.role, ROLES, 'Vai trò');
    const err = checkPasswordStrength(body.password);
    if (err) throw bad(err);
    const { hash, salt } = await hashPassword(body.password);
    const id = this.db.one(`INSERT INTO users (username, full_name, role, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      username, fullName, role, hash, salt, vnNow(this.now())).id;
    this.audit(user, 'tao', 'nguoi_dung', id, null, { username, fullName, role }, ip);
    return { id };
  }
  updateUser({ user, body, ip }, id) {
    this.need(user, ['quan_tri']);
    const before = this.db.one(`SELECT id, username, full_name, role, active, version FROM users WHERE id = ?`, id);
    if (!before) throw new HttpError(404, 'Không tìm thấy người dùng');
    checkVersion(body, before.version, 'Người dùng');
    const fullName = str(body.full_name ?? before.full_name, { field: 'họ tên', required: true, max: 100 });
    const role = oneOf(body.role ?? before.role, ROLES, 'Vai trò');
    const active = body.active === undefined ? before.active : (body.active ? 1 : 0);
    if (before.role === 'quan_tri' && (role !== 'quan_tri' || !active)) {
      const admins = Number(this.db.one(`SELECT COUNT(*) AS n FROM users WHERE role = 'quan_tri' AND active = 1 AND id != ?`, id).n);
      if (!admins) throw bad('Phải còn ít nhất 1 tài khoản Quản trị đang hoạt động');
    }
    this.db.run(`UPDATE users SET full_name = ?, role = ?, active = ?, version = version + 1 WHERE id = ?`, fullName, role, active, id);
    if (!active) this.db.run(`DELETE FROM sessions WHERE user_id = ?`, id);
    this.audit(user, 'sua', 'nguoi_dung', id, before, { full_name: fullName, role, active }, ip);
    return { ok: true };
  }
  async resetPassword({ user, body, ip }, id) {
    this.need(user, ['quan_tri']);
    if (!this.db.one(`SELECT id FROM users WHERE id = ?`, id)) throw new HttpError(404, 'Không tìm thấy người dùng');
    const err = checkPasswordStrength(body.password);
    if (err) throw bad(err);
    const { hash, salt } = await hashPassword(body.password);
    this.db.run(`UPDATE users SET pass_hash = ?, pass_salt = ?, fail_count = 0, locked_until = 0 WHERE id = ?`, hash, salt, id);
    this.db.run(`DELETE FROM sessions WHERE user_id = ?`, id);
    this.audit(user, 'dat_lai_mat_khau', 'nguoi_dung', id, null, null, ip);
    return { ok: true };
  }

  // ---------- cài đặt ----------
  updateSettings({ user, body, ip }) {
    this.need(user, ['quan_tri']);
    const before = this.settings();
    checkVersion(body, before.version, 'Cài đặt');
    const next = {
      company_name: str(body.company_name ?? before.company_name, { field: 'tên công ty', required: true, max: 200 }),
      company_mst: str(body.company_mst ?? before.company_mst, { field: 'MST', max: 20 }),
      company_address: str(body.company_address ?? before.company_address, { field: 'địa chỉ', max: 300 }),
      insolar_mst: str(body.insolar_mst ?? before.insolar_mst, { field: 'MST INSOLAR', max: 20 }),
      insolar_name: str(body.insolar_name ?? before.insolar_name, { field: 'tên INSOLAR', max: 200 }),
      approval_threshold: String(toMoney(body.approval_threshold ?? before.approval_threshold, { field: 'Ngưỡng duyệt' })),
    };
    const w = Number(body.warranty_pct ?? before.warranty_pct);
    if (!Number.isFinite(w) || w < 0 || w > 20) throw bad('Tỷ lệ dự phòng bảo hành phải từ 0 đến 20%');
    next.warranty_pct = String(Math.round(w * 100) / 100);
    next.cash_limit = String(toMoney(body.cash_limit ?? before.cash_limit, { field: 'Ngưỡng thanh toán không dùng tiền mặt' }));
    next.pit_threshold = String(toMoney(body.pit_threshold ?? before.pit_threshold, { field: 'Ngưỡng khấu trừ TNCN' }));
    const pr = Number(body.pit_rate ?? before.pit_rate);
    if (!Number.isFinite(pr) || pr < 0 || pr > 35) throw bad('Tỷ lệ khấu trừ TNCN không hợp lệ');
    next.pit_rate = String(pr);
    if (next.warranty_pct !== before.warranty_pct && before.locked_through) {
      // đổi tỷ lệ chỉ ảnh hưởng tháng chưa khoá (tháng đã khoá giữ nguyên ảnh chụp số liệu)
    }
    next.version = String(Number(before.version || 1) + 1);
    this.db.tx(() => Object.entries(next).forEach(([k, v]) => this.setSetting(k, v)));
    this.audit(user, 'sua', 'cai_dat', '', before, next, ip);
    return { ok: true };
  }
  validShareholders(list) {
    if (!Array.isArray(list) || !list.length) throw bad('Cần nhập ít nhất 1 cổ đông');
    if (list.length > 20) throw bad('Tối đa 20 cổ đông');
    const out = list.map(s => {
      const pctNum = Number(String(s.pct).replace(',', '.'));
      if (!Number.isFinite(pctNum) || pctNum <= 0 || pctNum > 100) throw bad('Tỷ lệ cổ phần không hợp lệ');
      return { name: str(s.name, { field: 'tên cổ đông', required: true, max: 100 }), pct_bp: Math.round(pctNum * 100), note: str(s.note, { max: 200 }) };
    });
    if (out.reduce((a, s) => a + s.pct_bp, 0) !== 10000) throw bad('Tổng tỷ lệ cổ phần phải đúng 100%');
    return out;
  }
  updateShareholders({ user, body, ip }) {
    this.need(user, ['quan_tri']);
    const list = this.validShareholders(body.shareholders);
    const before = this.db.all(`SELECT name, pct_bp, note FROM shareholders ORDER BY id`);
    const sv = this.settings().shareholders_version;
    checkVersion(body, sv, 'Danh sách cổ đông');
    this.db.tx(() => {
      this.setSetting('shareholders_version', Number(sv || 1) + 1);
      this.db.run(`DELETE FROM shareholders`);
      list.forEach(s => this.db.run(`INSERT INTO shareholders (name, pct_bp, note) VALUES (?, ?, ?)`, s.name, s.pct_bp, s.note));
    });
    this.audit(user, 'sua', 'co_dong', '', before, list, ip);
    return { ok: true };
  }

  // ---------- đối tác ----------
  partnerFrom(body) {
    return {
      kind: oneOf(body.kind || 'ncc', PARTNER_KIND, 'Loại đối tác'),
      name: str(body.name, { field: 'tên đối tác', required: true, max: 200 }),
      mst: str(body.mst, { field: 'MST', max: 20 }).replace(/\s/g, ''),
      address: str(body.address, { field: 'địa chỉ', max: 300 }),
      phone: str(body.phone, { field: 'điện thoại', max: 30 }),
      id_no: str(body.id_no, { field: 'số CCCD', max: 20 }).replace(/\s/g, ''),
    };
  }
  savePartner({ user, body, ip }, id) {
    this.need(user, ['quan_tri', 'ke_toan', 'chi_huy']);
    const p = this.partnerFrom(body);
    if (p.mst) {
      const dup = this.db.one(`SELECT id FROM partners WHERE mst = ? AND id != ?`, p.mst, id || 0);
      if (dup) throw bad('Đã có đối tác với mã số thuế này');
    }
    if (p.id_no && this.db.one(`SELECT id FROM partners WHERE id_no = ? AND id != ?`, p.id_no, id || 0)) throw bad('Đã có người với số CCCD này');
    if (!id && this.db.one(`SELECT id FROM partners WHERE lower(name) = lower(?) AND mst = ? AND id_no = ?`, p.name, p.mst, p.id_no)) throw bad('Đối tác này đã có trong danh sách');
    if (id) {
      const before = this.db.one(`SELECT * FROM partners WHERE id = ?`, id);
      if (!before) throw new HttpError(404, 'Không tìm thấy đối tác');
      checkVersion(body, before.version, 'Đối tác');
      if (user.role === 'chi_huy') throw new HttpError(403, 'Chỉ Kế toán/Quản trị được sửa đối tác');
      this.db.run(`UPDATE partners SET kind = ?, name = ?, mst = ?, address = ?, phone = ?, id_no = ?, version = version + 1 WHERE id = ?`, p.kind, p.name, p.mst, p.address, p.phone, p.id_no, id);
      this.audit(user, 'sua', 'doi_tac', id, before, p, ip);
      return { id };
    }
    const nid = this.db.one(`INSERT INTO partners (kind, name, mst, address, phone, id_no, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      p.kind, p.name, p.mst, p.address, p.phone, p.id_no, vnNow(this.now())).id;
    this.audit(user, 'tao', 'doi_tac', nid, null, p, ip);
    return { id: nid };
  }

  // ---------- công trình ----------
  saveProject({ user, body, ip }, id) {
    this.need(user, BOOKKEEPERS);
    const before = id ? this.db.one(`SELECT * FROM projects WHERE id = ?`, id) : null;
    if (id && !before) throw new HttpError(404, 'Không tìm thấy công trình');
    if (before) checkVersion(body, before.version, 'Công trình');
    const p = {
      name: str(body.name, { field: 'tên công trình', required: true, max: 200 }),
      customer_id: body.customer_id ? Number(body.customer_id) : null,
      address: str(body.address, { field: 'địa chỉ', max: 300 }),
      contract_value: toMoney(body.contract_value ?? 0, { field: 'Giá trị hợp đồng' }),
      vat_rate: Number(body.vat_rate ?? 8),
      start_date: body.start_date || this.today(),
      manager_user_id: body.manager_user_id ? Number(body.manager_user_id) : null,
      note: str(body.note, { field: 'ghi chú', max: 1000 }),
      status: body.status || (before ? before.status : 'dang_thi_cong'),
    };
    if (![0, 5, 8, 10].includes(p.vat_rate)) throw bad('Thuế suất phải là 0, 5, 8 hoặc 10%');
    if (!isDate(p.start_date)) throw bad('Ngày khởi công không hợp lệ');
    if (p.customer_id && !this.db.one(`SELECT id FROM partners WHERE id = ?`, p.customer_id)) throw bad('Khách hàng không tồn tại');
    if (p.manager_user_id && !this.db.one(`SELECT id FROM users WHERE id = ?`, p.manager_user_id)) throw bad('Người phụ trách không tồn tại');
    oneOf(p.status, PROJECT_STATUS, 'Trạng thái');
    if (p.status === 'da_nghiem_thu' && (!before || before.status !== 'da_nghiem_thu')) throw bad('Dùng nút "Nghiệm thu" để chuyển công trình sang đã nghiệm thu');
    if (before && before.status === 'da_nghiem_thu' && p.status !== 'da_nghiem_thu') throw bad('Dùng nút "Mở lại" để huỷ trạng thái nghiệm thu');
    if (id) {
      this.db.run(`UPDATE projects SET name = ?, customer_id = ?, address = ?, contract_value = ?, vat_rate = ?, start_date = ?, manager_user_id = ?, note = ?, status = ?, version = version + 1 WHERE id = ?`,
        p.name, p.customer_id, p.address, p.contract_value, p.vat_rate, p.start_date, p.manager_user_id, p.note, p.status, id);
      this.audit(user, 'sua', 'cong_trinh', id, before, p, ip);
      return { id };
    }
    let code = str(body.code, { field: 'mã công trình', max: 30 }).toUpperCase();
    if (!code) {
      const prefix = `CT-${this.today().slice(2, 4)}${this.today().slice(5, 7)}`;
      const n = Number(this.db.one(`SELECT COUNT(*) AS n FROM projects WHERE code LIKE ?`, prefix + '-%').n) + 1;
      code = `${prefix}-${String(n).padStart(2, '0')}`;
    }
    if (!/^[A-Z0-9._-]{2,30}$/.test(code)) throw bad('Mã công trình chỉ gồm chữ in hoa không dấu, số, dấu chấm/gạch');
    const nid = this.db.one(`INSERT INTO projects (code, name, customer_id, address, contract_value, vat_rate, status, start_date, manager_user_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      code, p.name, p.customer_id, p.address, p.contract_value, p.vat_rate, p.status, p.start_date, p.manager_user_id, p.note, vnNow(this.now())).id;
    this.audit(user, 'tao', 'cong_trinh', nid, null, { code, ...p }, ip);
    return { id: nid, code };
  }
  acceptProject({ user, body, ip }, id) {
    this.need(user, BOOKKEEPERS);
    const p = this.db.one(`SELECT * FROM projects WHERE id = ?`, id);
    if (!p) throw new HttpError(404, 'Không tìm thấy công trình');
    if (p.status === 'da_nghiem_thu') throw bad('Công trình đã nghiệm thu');
    if (p.status === 'huy') throw bad('Công trình đã huỷ');
    const date = body.date;
    this.assertDate(date, 'Ngày nghiệm thu');
    if (date < p.start_date) throw bad('Ngày nghiệm thu trước ngày khởi công');
    this.assertOpen(date);
    const pending = Number(this.db.one(`SELECT COUNT(*) AS n FROM costs WHERE project_id = ? AND status = 'cho_duyet' AND date <= ?`, id, date).n);
    if (pending) throw bad(`Còn ${pending} khoản chi của công trình đang chờ duyệt. Duyệt hoặc từ chối trước khi nghiệm thu.`);
    checkVersion(body, p.version, 'Công trình');
    this.db.run(`UPDATE projects SET status = 'da_nghiem_thu', accepted_date = ?, version = version + 1 WHERE id = ?`, date, id);
    this.audit(user, 'nghiem_thu', 'cong_trinh', id, { status: p.status }, { status: 'da_nghiem_thu', accepted_date: date }, ip);
    return { ok: true };
  }
  reopenProject({ user, body, ip }, id) {
    this.need(user, ['quan_tri']);
    const p = this.db.one(`SELECT * FROM projects WHERE id = ?`, id);
    if (!p || p.status !== 'da_nghiem_thu') throw bad('Công trình chưa nghiệm thu');
    this.assertOpen(p.accepted_date);
    const reason = str(body.reason, { field: 'lý do', required: true, max: 300 });
    this.db.run(`UPDATE projects SET status = 'dang_thi_cong', accepted_date = NULL, version = version + 1 WHERE id = ?`, id);
    this.audit(user, 'mo_lai', 'cong_trinh', id, { status: p.status, accepted_date: p.accepted_date }, { status: 'dang_thi_cong', reason }, ip);
    return { ok: true };
  }

  // ---------- chứng từ đính kèm ----------
  validAttachments(list, required) {
    const arr = Array.isArray(list) ? list : [];
    if (required && !arr.length) throw bad('Bắt buộc đính kèm ảnh/file chứng từ (hoá đơn, phiếu, bảng công...)');
    if (arr.length > MAX_ATTACH_PER_REQ) throw bad(`Tối đa ${MAX_ATTACH_PER_REQ} file mỗi lần`);
    return arr.map(a => {
      const mime = String(a.mime || '').toLowerCase();
      if (!ATTACH_MIME.test(mime)) throw bad('Chỉ nhận ảnh (JPG/PNG/WEBP/HEIC), PDF hoặc XML');
      let data;
      try { data = b64ToBytes(a.data); } catch { throw bad('File đính kèm bị lỗi'); }
      if (!data.length) throw bad('File đính kèm rỗng');
      if (data.length > MAX_ATTACH) throw bad(`File "${String(a.name || '').slice(0, 60)}" quá lớn (tối đa 1,9MB; ảnh sẽ được tự nén)`);
      return { name: str(a.name || 'chung-tu', { field: 'tên file', max: 200 }), mime, data };
    });
  }
  saveAttachments(user, ownerType, ownerId, atts) {
    atts.forEach(a => this.db.run(`INSERT INTO attachments (owner_type, owner_id, name, mime, size, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ownerType, ownerId, a.name, a.mime, a.data.length, a.data, user.id, vnNow(this.now())));
  }
  canSeeOwner(user, ownerType, ownerId) {
    const tables = { costs: 'costs', revenues: 'revenues', receipts: 'receipts', payments: 'payments', advances: 'advances', journals: 'journals' };
    if (!tables[ownerType]) return false;
    const row = this.db.one(`SELECT created_by FROM ${tables[ownerType]} WHERE id = ?`, ownerId);
    if (!row) return false;
    if (user.role === 'chi_huy') return (ownerType === 'costs' && row.created_by === user.id) || (ownerType === 'advances' && this.db.one(`SELECT user_id FROM advances WHERE id = ?`, ownerId).user_id === user.id);
    return true;
  }
  listAttachments({ user, q }) {
    const id = Number(q.owner_id);
    if (!this.canSeeOwner(user, q.owner_type, id)) throw new HttpError(404, 'Không tìm thấy');
    return { items: this.db.all(`SELECT id, name, mime, size, created_at FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY id`, q.owner_type, id) };
  }
  addAttachments({ user, body, ip }) {
    const id = Number(body.owner_id);
    if (!this.canSeeOwner(user, body.owner_type, id)) throw new HttpError(404, 'Không tìm thấy');
    const atts = this.validAttachments(body.attachments, true);
    this.db.tx(() => this.saveAttachments(user, body.owner_type, id, atts));
    this.audit(user, 'bo_sung_chung_tu', body.owner_type, id, null, atts.map(a => ({ name: a.name, size: a.data.length })), ip);
    return { ok: true };
  }
  getAttachment({ user }, id) {
    const a = this.db.one(`SELECT * FROM attachments WHERE id = ?`, id);
    if (!a || !this.canSeeOwner(user, a.owner_type, a.owner_id)) throw new HttpError(404, 'Không tìm thấy');
    const data = a.data instanceof ArrayBuffer ? new Uint8Array(a.data) : a.data;
    const safeName = encodeURIComponent(a.name);
    return new Response(data, {
      headers: {
        'content-type': a.mime, 'cache-control': 'private, max-age=86400',
        'content-disposition': `inline; filename*=UTF-8''${safeName}`, 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  }

  // ---------- chi phí ----------
  costFrom(body, user) {
    const s = this.settings();
    const date = body.date;
    this.assertDate(date, 'Ngày chứng từ');
    this.assertOpen(date);
    const projectId = body.project_id ? Number(body.project_id) : null;
    if (projectId) {
      const p = this.db.one(`SELECT status FROM projects WHERE id = ?`, projectId);
      if (!p) throw bad('Công trình không tồn tại');
      if (p.status === 'huy') throw bad('Công trình đã huỷ');
      oneOf(body.category, PROJECT_CATEGORIES, 'Loại chi phí công trình');
    } else {
      if (user.role === 'chi_huy') throw bad('Chỉ huy công trình phải chọn công trình');
      oneOf(body.category, OVERHEAD_CATEGORIES, 'Loại chi phí chung');
    }
    const partnerId = body.partner_id ? Number(body.partner_id) : null;
    if (partnerId && !this.db.one(`SELECT id FROM partners WHERE id = ?`, partnerId)) throw bad('Đối tác không tồn tại');
    const payMethod = oneOf(body.pay_method, PAY_METHODS, 'Hình thức thanh toán');
    if (payMethod === 'cong_no' && !partnerId) throw bad('Chi phí ghi công nợ phải chọn nhà cung cấp');
    if (['vat_tu_insolar', 'vat_tu_ngoai'].includes(body.category) && !partnerId) throw bad('Vật tư phải chọn nhà cung cấp');
    if (body.category === 'vat_tu_insolar') {
      const pt = this.db.one(`SELECT mst FROM partners WHERE id = ?`, partnerId);
      if (s.insolar_mst && pt.mst !== s.insolar_mst) throw bad('Loại "Vật tư lấy của INSOLAR" phải chọn đúng nhà cung cấp INSOLAR (theo MST trong Cài đặt)');
    }
    const net = toMoney(body.amount_net, { field: 'Tiền trước thuế' });
    let vat = toMoney(body.vat ?? 0, { field: 'Thuế GTGT' });
    if (net <= 0) throw bad('Tiền trước thuế phải lớn hơn 0');
    if (vat > net) throw bad('Thuế GTGT lớn hơn tiền hàng — kiểm tra lại');
    // Chi phí không có hoá đơn GTGT: không có thuế GTGT đầu vào; mua của cá nhân → Bảng kê 01/TNDN; thuê khoán cá nhân → khấu trừ TNCN.
    const evidence = oneOf(body.evidence || 'hoa_don_gtgt', EVIDENCE, 'Loại chứng từ');
    if (evidence !== 'hoa_don_gtgt' && vat) throw bad('Chỉ hoá đơn GTGT mới có thuế GTGT đầu vào. Với loại chứng từ này, nhập thuế = 0.');
    if (['bang_ke', 'nhan_cong_khoan'].includes(evidence)) {
      if (!partnerId) throw bad('Chọn người bán/người nhận tiền (họ tên, địa chỉ, số CCCD) để lên bảng kê');
      const pt = this.db.one(`SELECT address, id_no FROM partners WHERE id = ?`, partnerId);
      if (!pt.address && !pt.id_no) throw bad('Người bán/người nhận cần có địa chỉ hoặc số CCCD (sửa trong mục Nhà cung cấp)');
    }
    let pit = 0;
    if (evidence === 'nhan_cong_khoan' && !body.pit_exempt) {
      pit = body.pit === undefined || body.pit === '' || body.pit === null
        ? (net >= Number(s.pit_threshold || 0) ? Math.round(net * Number(s.pit_rate || 0) / 100) : 0)
        : toMoney(body.pit, { field: 'Thuế TNCN khấu trừ' });
      if (pit > net) throw bad('Thuế TNCN khấu trừ lớn hơn tiền công');
    }
    let advanceUserId = null;
    if (payMethod === 'tam_ung') {
      advanceUserId = user.role === 'chi_huy' ? user.id : Number(body.advance_user_id || user.id);
      if (!this.db.one(`SELECT id FROM users WHERE id = ?`, advanceUserId)) throw bad('Người tạm ứng không tồn tại');
    }
    return {
      date, project_id: projectId, category: body.category, partner_id: partnerId,
      description: str(body.description, { field: 'nội dung', required: true, max: 500 }),
      amount_net: net, vat, pay_method: payMethod, evidence, pit, advance_user_id: advanceUserId,
      invoice_no: str(body.invoice_no, { field: 'số hoá đơn', max: 50 }),
      invoice_date: body.invoice_date && isDate(body.invoice_date) ? body.invoice_date : '',
    };
  }
  costWarnings(c) {
    const s = this.settings();
    const w = [];
    if (vatBlocked(c, Number(s.cash_limit) || 0)) w.push(`Trả tiền mặt từ ${Number(s.cash_limit).toLocaleString('vi-VN')}đ: thuế GTGT đầu vào của khoản này KHÔNG được khấu trừ. Nên chuyển khoản.`);
    if (c.evidence === 'khong_hop_le') w.push('Khoản chi không có chứng từ hợp lệ: không được trừ khi tính thuế TNDN.');
    if (c.project_id) {
      const b = this.db.one(`SELECT amount FROM budgets WHERE project_id = ? AND category = ?`, c.project_id, c.category);
      if (b && b.amount > 0) {
        const used = Number(this.db.one(`SELECT COALESCE(SUM(amount_net), 0) AS v FROM costs WHERE project_id = ? AND category = ? AND status IN ('da_duyet', 'cho_duyet')`, c.project_id, c.category).v);
        if (used > b.amount) w.push(`Vượt dự toán "${CATEGORIES[c.category]}": đã dùng ${used.toLocaleString('vi-VN')} / ${b.amount.toLocaleString('vi-VN')}đ.`);
      }
    }
    return w;
  }
  needsApproval(c, creator) {
    const threshold = Number(this.settings().approval_threshold) || 0;
    return creator.role === 'chi_huy' || creator.role === 'co_dong' || c.amount_net + c.vat > threshold;
  }
  insertCost(user, c, extra = {}) {
    const pending = this.needsApproval(c, user);
    const now = vnNow(this.now());
    const row = this.db.one(`INSERT INTO costs (code, date, project_id, category, partner_id, description, amount_net, vat, pay_method, invoice_no, invoice_date, evidence, pit, advance_user_id, status, source, einvoice_key, created_by, created_at, approved_by, approved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, code, status`,
      this.nextCode('CP'), c.date, c.project_id, c.category, c.partner_id, c.description, c.amount_net, c.vat, c.pay_method, c.invoice_no, c.invoice_date, c.evidence, c.pit, c.advance_user_id,
      pending ? 'cho_duyet' : 'da_duyet', extra.source || 'tay', extra.einvoice_key || null, user.id, now,
      pending ? null : user.id, pending ? null : now);
    return row;
  }
  // Chống nhập trùng chứng từ: cùng NCC + cùng số hoá đơn → chặn; cùng người, cùng công trình, cùng số tiền, cùng ngày trong 30 phút → hỏi lại.
  checkCostDuplicate(c, user, allow) {
    if (c.invoice_no && c.partner_id) {
      const d = this.db.one(`SELECT code FROM costs WHERE partner_id = ? AND lower(invoice_no) = lower(?) AND status IN ('cho_duyet', 'da_duyet') AND reverses_id IS NULL AND reversed_by_id IS NULL`, c.partner_id, c.invoice_no);
      if (d) throw new HttpError(409, `Hoá đơn số ${c.invoice_no} của nhà cung cấp này đã nhập ở ${d.code}.`);
    }
    if (!allow) {
      const since = vnNow(this.now() - 30 * 60000);
      const d = this.db.one(`SELECT code, created_by FROM costs WHERE date = ? AND amount_net = ? AND category = ? AND COALESCE(project_id, 0) = ? AND status IN ('cho_duyet', 'da_duyet') AND reverses_id IS NULL AND created_at >= ?`,
        c.date, c.amount_net, c.category, c.project_id || 0, since);
      if (d) throw dupError(`Có vẻ trùng với ${d.code} vừa nhập (cùng ngày, cùng công trình, cùng loại, cùng số tiền). Vẫn lưu?`);
    }
  }
  createCost({ user, body, ip }) {
    this.need(user, ['quan_tri', 'ke_toan', 'chi_huy']);
    const c = this.costFrom(body, user);
    this.checkCostDuplicate(c, user, !!body.allow_duplicate);
    const atts = this.validAttachments(body.attachments, true);
    let row;
    this.db.tx(() => {
      row = this.insertCost(user, c);
      this.saveAttachments(user, 'costs', row.id, atts);
      this.audit(user, 'tao', 'chi_phi', row.code, null, { ...c, status: row.status, files: atts.length }, ip);
    });
    return { ...row, warnings: this.costWarnings(c) };
  }
  previewEInvoice({ user, body }) {
    this.need(user, ['quan_tri', 'ke_toan', 'chi_huy']);
    let inv;
    try { inv = parseEInvoice(String(body.xml || '')); } catch (e) { throw bad(e.message); }
    const s = this.settings();
    const partner = this.db.one(`SELECT id, name FROM partners WHERE mst = ?`, inv.seller.mst);
    const dup = this.db.one(`SELECT code FROM costs WHERE einvoice_key = ?`, inv.key);
    const buyerOk = !s.company_mst || !inv.buyer.mst || inv.buyer.mst === s.company_mst;
    return { invoice: inv, partner, duplicate: dup ? dup.code : '', is_insolar: !!s.insolar_mst && inv.seller.mst === s.insolar_mst, buyer_ok: buyerOk };
  }
  importEInvoice({ user, body, ip }) {
    this.need(user, ['quan_tri', 'ke_toan', 'chi_huy']);
    let inv;
    const xml = String(body.xml || '');
    if (xml.length > MAX_ATTACH) throw bad('File XML quá lớn');
    try { inv = parseEInvoice(xml); } catch (e) { throw bad(e.message); }
    const s = this.settings();
    if (s.company_mst && inv.buyer.mst && inv.buyer.mst !== s.company_mst) throw bad(`Hoá đơn này xuất cho MST ${inv.buyer.mst}, không phải công ty (${s.company_mst}).`);
    if (this.db.one(`SELECT code FROM costs WHERE einvoice_key = ?`, inv.key)) throw new HttpError(409, 'Hoá đơn này đã được nhập trước đó.');
    const isInsolar = !!s.insolar_mst && inv.seller.mst === s.insolar_mst;
    const extraAtts = this.validAttachments(body.attachments, false);
    let row;
    this.db.tx(() => {
      let partner = this.db.one(`SELECT id FROM partners WHERE mst = ?`, inv.seller.mst);
      if (!partner) {
        partner = this.db.one(`INSERT INTO partners (kind, name, mst, address, phone, created_at) VALUES ('ncc', ?, ?, ?, '', ?) RETURNING id`,
          inv.seller.name || inv.seller.mst, inv.seller.mst, inv.seller.address, vnNow(this.now()));
        this.audit(user, 'tao', 'doi_tac', partner.id, null, { name: inv.seller.name, mst: inv.seller.mst, tu: 'hoa_don_dien_tu' }, ip);
      }
      const category = body.project_id ? (isInsolar ? 'vat_tu_insolar' : (body.category || 'vat_tu_ngoai')) : (body.category || 'chung_khac');
      const c = this.costFrom({
        date: body.date || inv.date, project_id: body.project_id, category, partner_id: partner.id,
        description: str(body.description, { max: 500 }) || `Hoá đơn ${inv.series} số ${inv.number} — ${inv.seller.name}`,
        amount_net: inv.net, vat: inv.vat, pay_method: body.pay_method || 'cong_no', advance_user_id: body.advance_user_id,
        evidence: inv.template === '2' ? 'hoa_don_ban_hang' : 'hoa_don_gtgt',
        invoice_no: `${inv.series}-${inv.number}`, invoice_date: inv.date,
      }, user);
      if (c.amount_net <= 0) throw bad('Hoá đơn có tổng tiền bằng 0 hoặc âm');
      row = this.insertCost(user, c, { source: 'hddt', einvoice_key: inv.key });
      inv.lines.forEach(l => this.db.run(`INSERT INTO cost_lines (cost_id, name, unit, qty, price, amount, vat_rate) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        row.id, l.name.slice(0, 300), l.unit.slice(0, 30), l.qty, l.price, l.amount, l.vat_rate.slice(0, 10)));
      const xmlBytes = new TextEncoder().encode(xml);
      this.saveAttachments(user, 'costs', row.id, [{ name: `HD-${inv.series}-${inv.number}.xml`, mime: 'application/xml', data: xmlBytes }, ...extraAtts]);
      this.audit(user, 'nhap_hddt', 'chi_phi', row.code, null, { ...c, status: row.status, key: inv.key }, ip);
      row.warnings = this.costWarnings(c);
    });
    return row;
  }
  listCosts({ user, q }) {
    const where = [], args = [];
    if (user.role === 'chi_huy') { where.push('c.created_by = ?'); args.push(user.id); }
    if (q.month && isMonth(q.month)) { where.push('c.date BETWEEN ? AND ?'); args.push(q.month + '-01', monthEnd(q.month)); }
    if (q.project_id === 'chung') where.push('c.project_id IS NULL');
    else if (q.project_id) { where.push('c.project_id = ?'); args.push(Number(q.project_id)); }
    if (q.status) { where.push('c.status = ?'); args.push(String(q.status)); }
    if (q.partner_id) { where.push('c.partner_id = ?'); args.push(Number(q.partner_id)); }
    const limit = Math.min(Number(q.limit) || 500, 2000);
    const rows = this.db.all(`SELECT c.*, (SELECT COUNT(*) FROM attachments a WHERE a.owner_type = 'costs' AND a.owner_id = c.id) AS files
      FROM costs c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.date DESC, c.id DESC LIMIT ${limit}`, ...args);
    return { items: rows };
  }
  getCost({ user }, id) {
    const c = this.db.one(`SELECT * FROM costs WHERE id = ?`, id);
    if (!c || (user.role === 'chi_huy' && c.created_by !== user.id)) throw new HttpError(404, 'Không tìm thấy');
    return {
      cost: c,
      lines: this.db.all(`SELECT * FROM cost_lines WHERE cost_id = ? ORDER BY id`, id),
      files: this.db.all(`SELECT id, name, mime, size, created_at FROM attachments WHERE owner_type = 'costs' AND owner_id = ? ORDER BY id`, id),
      history: this.db.all(`SELECT at, user_id, action, before_json, after_json FROM audit WHERE entity = 'chi_phi' AND entity_id = ? ORDER BY id`, c.code),
    };
  }
  updateCost({ user, body, ip }, id) {
    const before = this.db.one(`SELECT * FROM costs WHERE id = ?`, id);
    if (!before) throw new HttpError(404, 'Không tìm thấy');
    checkVersion(body, before.version, 'Khoản chi');
    if (before.status !== 'cho_duyet') throw bad('Chỉ sửa được khoản chi đang chờ duyệt. Khoản đã ghi sổ phải huỷ bằng bút toán đảo.');
    if (!(before.created_by === user.id || BOOKKEEPERS.includes(user.role))) throw new HttpError(403, 'Bạn không có quyền sửa khoản chi này');
    this.assertOpen(before.date);
    const c = this.costFrom(body, user);
    if (before.source === 'hddt' && (c.amount_net !== before.amount_net || c.vat !== before.vat || c.partner_id !== before.partner_id)) {
      throw bad('Khoản chi nhập từ hoá đơn điện tử không được sửa số tiền/nhà cung cấp');
    }
    this.db.run(`UPDATE costs SET date = ?, project_id = ?, category = ?, partner_id = ?, description = ?, amount_net = ?, vat = ?, pay_method = ?, invoice_no = ?, invoice_date = ?, evidence = ?, pit = ?, advance_user_id = ?, version = version + 1 WHERE id = ?`,
      c.date, c.project_id, c.category, c.partner_id, c.description, c.amount_net, c.vat, c.pay_method, c.invoice_no, c.invoice_date, c.evidence, c.pit, c.advance_user_id, id);
    this.audit(user, 'sua', 'chi_phi', before.code, before, c, ip);
    return { ok: true };
  }
  approveCost({ user, body, ip }, id) {
    this.need(user, APPROVERS);
    const c = this.db.one(`SELECT * FROM costs WHERE id = ?`, id);
    if (!c) throw new HttpError(404, 'Không tìm thấy');
    checkVersion(body, c.version, 'Khoản chi');
    if (c.status !== 'cho_duyet') throw bad('Khoản chi không ở trạng thái chờ duyệt');
    if (c.created_by === user.id) throw bad('Không được tự duyệt khoản chi do mình lập');
    this.assertOpen(c.date);
    this.db.run(`UPDATE costs SET status = 'da_duyet', approved_by = ?, approved_at = ?, version = version + 1 WHERE id = ?`, user.id, vnNow(this.now()), id);
    this.audit(user, 'duyet', 'chi_phi', c.code, { status: c.status }, { status: 'da_duyet' }, ip);
    return { ok: true };
  }
  rejectCost({ user, body, ip }, id) {
    const c = this.db.one(`SELECT * FROM costs WHERE id = ?`, id);
    if (!c) throw new HttpError(404, 'Không tìm thấy');
    if (!(APPROVERS.includes(user.role) || c.created_by === user.id)) throw new HttpError(403, 'Bạn không có quyền');
    checkVersion(body, c.version, 'Khoản chi');
    if (c.status !== 'cho_duyet') throw bad('Khoản chi không ở trạng thái chờ duyệt');
    const reason = str(body.reason, { field: 'lý do', required: true, max: 300 });
    this.db.run(`UPDATE costs SET status = 'tu_choi', reason = ?, approved_by = ?, approved_at = ?, einvoice_key = NULL, version = version + 1 WHERE id = ?`, reason, user.id, vnNow(this.now()), id);
    this.audit(user, 'tu_choi', 'chi_phi', c.code, { status: c.status }, { status: 'tu_choi', reason }, ip);
    return { ok: true };
  }

  // ---------- doanh thu, thu tiền, trả NCC ----------
  ledgerConf(t) {
    return {
      revenues: { prefix: 'DT', entity: 'doanh_thu', needFile: true },
      receipts: { prefix: 'PT', entity: 'thu_tien', needFile: false },
      payments: { prefix: 'PC', entity: 'tra_ncc', needFile: true },
    }[t];
  }
  listLedger({ user, q }, t) {
    this.need(user, VIEWERS);
    const where = [], args = [];
    if (q.month && isMonth(q.month)) { where.push('date BETWEEN ? AND ?'); args.push(q.month + '-01', monthEnd(q.month)); }
    if (q.project_id && t !== 'payments') { where.push('project_id = ?'); args.push(Number(q.project_id)); }
    if (q.partner_id && t === 'payments') { where.push('partner_id = ?'); args.push(Number(q.partner_id)); }
    return { items: this.db.all(`SELECT x.*, (SELECT COUNT(*) FROM attachments a WHERE a.owner_type = '${t}' AND a.owner_id = x.id) AS files FROM ${t} x ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, id DESC LIMIT 2000`, ...args) };
  }
  createLedger({ user, body, ip }, t) {
    this.need(user, BOOKKEEPERS);
    const conf = this.ledgerConf(t);
    const date = body.date;
    if (t === 'revenues' && body.invoice_no) {
      const d = this.db.one(`SELECT code FROM revenues WHERE project_id = ? AND lower(invoice_no) = lower(?) AND reverses_id IS NULL AND reversed_by_id IS NULL`, Number(body.project_id), String(body.invoice_no).trim());
      if (d) throw new HttpError(409, `Hoá đơn số ${body.invoice_no} đã ghi doanh thu ở ${d.code}.`);
    }
    if (!body.allow_duplicate) {
      const since = vnNow(this.now() - 30 * 60000);
      const amt = t === 'revenues' ? Math.round(Number(String(body.amount_net).replace(/[.\s,đ]/g, '')) || 0) : Math.round(Number(String(body.amount).replace(/[.\s,đ]/g, '')) || 0);
      const d = t === 'payments'
        ? this.db.one(`SELECT code FROM payments WHERE date = ? AND partner_id = ? AND amount = ? AND reverses_id IS NULL AND created_at >= ?`, date, Number(body.partner_id), amt, since)
        : this.db.one(`SELECT code FROM ${t} WHERE date = ? AND project_id = ? AND ${t === 'revenues' ? 'amount_net' : 'amount'} = ? AND reverses_id IS NULL AND created_at >= ?`, date, Number(body.project_id), amt, since);
      if (d) throw dupError(`Có vẻ trùng với ${d.code} vừa nhập (cùng ngày, cùng đối tượng, cùng số tiền). Vẫn lưu?`);
    }
    this.assertDate(date, 'Ngày');
    this.assertOpen(date);
    const description = str(body.description, { field: 'nội dung', required: t === 'revenues', max: 500 });
    const atts = this.validAttachments(body.attachments, conf.needFile);
    const now = vnNow(this.now());
    let row;
    this.db.tx(() => {
      const code = this.nextCode(conf.prefix);
      if (t === 'payments') {
        const partnerId = Number(body.partner_id);
        if (!this.db.one(`SELECT id FROM partners WHERE id = ?`, partnerId)) throw bad('Chọn nhà cung cấp');
        const amount = toMoney(body.amount, { field: 'Số tiền' });
        if (amount <= 0) throw bad('Số tiền phải lớn hơn 0');
        const method = oneOf(body.method, CASH_METHODS, 'Hình thức');
        row = this.db.one(`INSERT INTO payments (code, date, partner_id, amount, method, description, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'da_duyet', ?, ?) RETURNING id, code`,
          code, date, partnerId, amount, method, description, user.id, now);
        this.audit(user, 'tao', conf.entity, code, null, { date, partnerId, amount, method, description }, ip);
      } else {
        const projectId = Number(body.project_id);
        const p = this.db.one(`SELECT status FROM projects WHERE id = ?`, projectId);
        if (!p) throw bad('Chọn công trình');
        if (t === 'revenues') {
          if (p.status === 'huy') throw bad('Công trình đã huỷ');
          const net = toMoney(body.amount_net, { field: 'Doanh thu trước thuế' });
          const vat = toMoney(body.vat ?? 0, { field: 'Thuế GTGT' });
          if (net <= 0) throw bad('Doanh thu phải lớn hơn 0');
          if (vat > net) throw bad('Thuế GTGT lớn hơn doanh thu — kiểm tra lại');
          const invoiceNo = str(body.invoice_no, { field: 'số hoá đơn', max: 50 });
          row = this.db.one(`INSERT INTO revenues (code, date, project_id, description, amount_net, vat, invoice_no, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'da_duyet', ?, ?) RETURNING id, code`,
            code, date, projectId, description, net, vat, invoiceNo, user.id, now);
          this.audit(user, 'tao', conf.entity, code, null, { date, projectId, net, vat, invoiceNo, description }, ip);
        } else {
          const amount = toMoney(body.amount, { field: 'Số tiền' });
          if (amount <= 0) throw bad('Số tiền phải lớn hơn 0');
          const method = oneOf(body.method, CASH_METHODS, 'Hình thức');
          row = this.db.one(`INSERT INTO receipts (code, date, project_id, amount, method, description, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'da_duyet', ?, ?) RETURNING id, code`,
            code, date, projectId, amount, method, description, user.id, now);
          this.audit(user, 'tao', conf.entity, code, null, { date, projectId, amount, method, description }, ip);
        }
      }
      this.saveAttachments(user, t, row.id, atts);
    });
    return row;
  }

  // Huỷ chứng từ đã ghi sổ = lập bút toán đảo (số âm), không xoá bản gốc.
  voidEntry({ user, body, ip }, t, id) {
    this.need(user, BOOKKEEPERS);
    const entity = { costs: 'chi_phi', revenues: 'doanh_thu', receipts: 'thu_tien', payments: 'tra_ncc', advances: 'tam_ung', journals: 'but_toan' }[t];
    const prefix = { costs: 'CP', revenues: 'DT', receipts: 'PT', payments: 'PC', advances: 'TU', journals: 'BT' }[t];
    const o = this.db.one(`SELECT * FROM ${t} WHERE id = ?`, id);
    if (!o) throw new HttpError(404, 'Không tìm thấy');
    if (o.status !== 'da_duyet') throw bad(t === 'costs' && o.status === 'cho_duyet' ? 'Khoản chưa ghi sổ: dùng "Từ chối" thay vì huỷ' : 'Chứng từ chưa ghi sổ');
    if (o.reverses_id) throw bad('Đây là bút toán đảo, không huỷ được');
    if (o.reversed_by_id) throw bad('Chứng từ đã được huỷ trước đó');
    const reason = str(body.reason, { field: 'lý do huỷ', required: true, max: 300 });
    const lt = this.settings().locked_through;
    const date = lt && monthOf(o.date) <= lt ? this.today() : o.date;
    this.assertOpen(date);
    const now = vnNow(this.now());
    let row;
    this.db.tx(() => {
      const code = this.nextCode(prefix);
      const desc = `Huỷ ${o.code}: ${reason}`.slice(0, 500);
      if (t === 'costs') {
        row = this.db.one(`INSERT INTO costs (code, date, project_id, category, partner_id, description, amount_net, vat, pay_method, invoice_no, invoice_date, evidence, pit, advance_user_id, status, reverses_id, reason, source, created_by, created_at, approved_by, approved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'da_duyet', ?, ?, 'dao', ?, ?, ?, ?) RETURNING id, code`,
          code, date, o.project_id, o.category, o.partner_id, desc, -o.amount_net, -o.vat, o.pay_method, o.invoice_no, o.invoice_date, o.evidence, -o.pit, o.advance_user_id, o.id, reason, user.id, now, user.id, now);
        this.db.run(`UPDATE costs SET reversed_by_id = ?, einvoice_key = NULL, version = version + 1 WHERE id = ?`, row.id, o.id);
      } else if (t === 'revenues') {
        row = this.db.one(`INSERT INTO revenues (code, date, project_id, description, amount_net, vat, invoice_no, status, reverses_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'da_duyet', ?, ?, ?, ?) RETURNING id, code`,
          code, date, o.project_id, desc, -o.amount_net, -o.vat, o.invoice_no, o.id, reason, user.id, now);
        this.db.run(`UPDATE revenues SET reversed_by_id = ? WHERE id = ?`, row.id, o.id);
      } else if (t === 'receipts') {
        row = this.db.one(`INSERT INTO receipts (code, date, project_id, amount, method, description, status, reverses_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'da_duyet', ?, ?, ?, ?) RETURNING id, code`,
          code, date, o.project_id, -o.amount, o.method, desc, o.id, reason, user.id, now);
        this.db.run(`UPDATE receipts SET reversed_by_id = ? WHERE id = ?`, row.id, o.id);
      } else if (t === 'payments') {
        row = this.db.one(`INSERT INTO payments (code, date, partner_id, amount, method, description, status, reverses_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'da_duyet', ?, ?, ?, ?) RETURNING id, code`,
          code, date, o.partner_id, -o.amount, o.method, desc, o.id, reason, user.id, now);
        this.db.run(`UPDATE payments SET reversed_by_id = ? WHERE id = ?`, row.id, o.id);
      } else if (t === 'advances') {
        row = this.db.one(`INSERT INTO advances (code, date, user_id, kind, amount, method, description, status, reverses_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'da_duyet', ?, ?, ?, ?) RETURNING id, code`,
          code, date, o.user_id, o.kind, -o.amount, o.method, desc, o.id, reason, user.id, now);
        this.db.run(`UPDATE advances SET reversed_by_id = ? WHERE id = ?`, row.id, o.id);
      } else {
        // bút toán đảo: đổi bên Nợ/Có
        row = this.db.one(`INSERT INTO journals (code, date, kind, description, status, reverses_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, 'da_duyet', ?, ?, ?, ?) RETURNING id, code`,
          code, date, o.kind, desc, o.id, reason, user.id, now);
        this.db.all(`SELECT * FROM journal_lines WHERE journal_id = ?`, o.id).forEach(l =>
          this.db.run(`INSERT INTO journal_lines (journal_id, acc, obj, debit, credit) VALUES (?, ?, ?, ?, ?)`, row.id, l.acc, l.obj, l.credit, l.debit));
        this.db.run(`UPDATE journals SET reversed_by_id = ? WHERE id = ?`, row.id, o.id);
      }
      this.audit(user, 'huy', entity, o.code, { code: o.code }, { reversal: row.code, date, reason }, ip);
    });
    return row;
  }

  // ---------- báo cáo ----------
  ledgerData() {
    return {
      settings: this.settings(),
      projects: this.db.all(`SELECT * FROM projects ORDER BY code`),
      partners: this.db.all(`SELECT * FROM partners`),
      shareholders: this.db.all(`SELECT name, pct_bp FROM shareholders ORDER BY id`),
      users: this.db.all(`SELECT id, full_name FROM users`),
      budgets: this.db.all(`SELECT project_id, category, amount FROM budgets`),
      advances: this.db.all(`SELECT id, code, date, user_id, kind, amount, method, description FROM advances WHERE status = 'da_duyet'`),
      journals: this.journalsWithLines(`WHERE status = 'da_duyet'`),
      costs: this.db.all(`SELECT id, code, date, project_id, category, partner_id, description, amount_net, vat, pay_method, evidence, pit, advance_user_id FROM costs WHERE status = 'da_duyet'`),
      revenues: this.db.all(`SELECT id, code, date, project_id, description, amount_net, vat FROM revenues WHERE status = 'da_duyet'`),
      receipts: this.db.all(`SELECT id, code, date, project_id, amount, method, description FROM receipts WHERE status = 'da_duyet'`),
      payments: this.db.all(`SELECT id, code, date, partner_id, amount, method, description FROM payments WHERE status = 'da_duyet'`),
    };
  }
  async reportHash(rep) { return sha256Hex(JSON.stringify(rep)); }
  async reportMonth({ user, q }) {
    this.need(user, VIEWERS);
    if (!isMonth(q.m)) throw bad('Tháng không hợp lệ');
    const lock = this.db.one(`SELECT * FROM month_locks WHERE month = ?`, q.m);
    const live = monthlyReport(this.ledgerData(), q.m);
    const pending = Number(this.db.one(`SELECT COUNT(*) AS n FROM costs WHERE status = 'cho_duyet' AND date BETWEEN ? AND ?`, q.m + '-01', monthEnd(q.m)).n);
    let report = live, integrity = null;
    if (lock) {
      // Tháng đã khoá: luôn hiện ảnh chụp lúc khoá (số đã ký). Đồng thời tính lại để kiểm tra không ai sửa dữ liệu ngầm.
      report = JSON.parse(lock.figures_json);
      integrity = (await this.reportHash(fingerprint(live))) === (await this.reportHash(fingerprint(report)));
    }
    const signoffs = this.db.all(`SELECT s.user_id, u.full_name, s.signed_at, s.figures_hash, s.note FROM signoffs s JOIN users u ON u.id = s.user_id WHERE s.month = ? ORDER BY s.id`, q.m);
    return { report, locked: !!lock, lock: lock ? { locked_at: lock.locked_at, locked_by: lock.locked_by, hash: lock.figures_hash } : null, integrity, pending, signoffs };
  }
  reportProjects({ user }) {
    this.need(user, VIEWERS);
    return { items: projectsSummary(this.ledgerData()) };
  }
  reportJournal({ user, q }) {
    this.need(user, VIEWERS);
    if (!isMonth(q.m)) throw bad('Tháng không hợp lệ');
    return journal(this.ledgerData(), q.m);
  }
  reportBalances({ user }) {
    this.need(user, VIEWERS);
    const d = this.ledgerData();
    return { ...balances(d, d.settings.insolar_mst), insolar: insolarReconcile(d, d.settings.insolar_mst), projects: projectsSummary(d) };
  }
  dashboard({ user }) {
    const m = this.today().slice(0, 7);
    const pendingWhere = user.role === 'chi_huy' ? `AND created_by = ${Number(user.id)}` : '';
    const pending = this.db.all(`SELECT id, code, date, project_id, description, amount_net, vat, created_by FROM costs WHERE status = 'cho_duyet' ${pendingWhere} ORDER BY date LIMIT 50`);
    if (user.role === 'chi_huy') {
      const adv = advanceBalances(this.ledgerData(), this.db.all(`SELECT pay_method, advance_user_id, amount_net, vat, pit FROM costs WHERE status = 'cho_duyet'`)).find(a => a.user_id === user.id) || null;
      return { month: m, pending, chi_huy: true, advance: adv };
    }
    const rep = monthlyReport(this.ledgerData(), m);
    const s = this.settings();
    return { month: m, pending, report: rep, locked_through: s.locked_through };
  }

  // ---------- khoá sổ & ký xác nhận ----------
  listLocks({ user }) {
    this.need(user, VIEWERS);
    const locks = this.db.all(`SELECT month, locked_by, locked_at, figures_hash FROM month_locks ORDER BY month DESC`);
    const sig = this.db.all(`SELECT s.month, s.user_id, u.full_name, s.signed_at, s.note FROM signoffs s JOIN users u ON u.id = s.user_id ORDER BY s.id`);
    return { locked_through: this.settings().locked_through, items: locks.map(l => ({ ...l, signoffs: sig.filter(x => x.month === l.month) })) };
  }
  async lockMonth({ user, body, ip }) {
    this.need(user, BOOKKEEPERS);
    const m = body.month;
    if (!isMonth(m)) throw bad('Tháng không hợp lệ');
    if (m >= this.today().slice(0, 7)) throw bad('Chỉ khoá được tháng đã kết thúc');
    const s = this.settings();
    if (s.locked_through && m <= s.locked_through) throw bad(`Đã khoá đến tháng ${s.locked_through}`);
    const pending = Number(this.db.one(`SELECT COUNT(*) AS n FROM costs WHERE status = 'cho_duyet' AND date <= ?`, monthEnd(m)).n);
    if (pending) throw bad(`Còn ${pending} khoản chi chờ duyệt đến hết tháng ${m}. Duyệt hoặc từ chối hết trước khi khoá sổ.`);
    // khoá lần lượt từng tháng chưa khoá đến tháng m
    const first = this.db.one(`SELECT MIN(d) AS d FROM (SELECT MIN(date) AS d FROM costs UNION ALL SELECT MIN(date) FROM revenues UNION ALL SELECT MIN(date) FROM receipts UNION ALL SELECT MIN(date) FROM payments)`).d;
    let cur = s.locked_through ? nextMonth(s.locked_through) : (first ? monthOf(first) : m);
    if (cur > m) cur = m;
    const data = this.ledgerData();
    const snaps = [];
    for (let k = cur; k <= m; k = nextMonth(k)) {
      const rep = monthlyReport(data, k);
      snaps.push({ month: k, json: JSON.stringify(rep), hash: await this.reportHash(rep) });
      if (snaps.length > 240) throw bad('Khoảng thời gian khoá quá dài');
    }
    const now = vnNow(this.now());
    this.db.tx(() => {
      snaps.forEach(sn => this.db.run(`INSERT INTO month_locks (month, locked_by, locked_at, figures_json, figures_hash) VALUES (?, ?, ?, ?, ?)`, sn.month, user.id, now, sn.json, sn.hash));
      this.setSetting('locked_through', m);
      this.audit(user, 'khoa_so', 'thang', m, { locked_through: s.locked_through }, { locked_through: m, months: snaps.map(x => x.month) }, ip);
    });
    return { ok: true, months: snaps.map(x => x.month) };
  }
  signoff({ user, body, ip }) {
    this.need(user, ['co_dong', 'quan_tri']);
    const m = body.month;
    const lock = this.db.one(`SELECT figures_hash FROM month_locks WHERE month = ?`, m);
    if (!lock) throw bad('Tháng chưa khoá sổ, chưa ký xác nhận được');
    if (this.db.one(`SELECT id FROM signoffs WHERE month = ? AND user_id = ?`, m, user.id)) throw bad('Bạn đã ký xác nhận tháng này');
    const note = str(body.note, { field: 'ghi chú', max: 500 });
    this.db.run(`INSERT INTO signoffs (month, user_id, signed_at, figures_hash, note) VALUES (?, ?, ?, ?, ?)`, m, user.id, vnNow(this.now()), lock.figures_hash, note);
    this.audit(user, 'ky_xac_nhan', 'thang', m, null, { hash: lock.figures_hash, note }, ip);
    return { ok: true };
  }

  journalsWithLines(where, ...args) {
    const js = this.db.all(`SELECT * FROM journals ${where} ORDER BY date, id`, ...args);
    if (!js.length) return [];
    const lines = this.db.all(`SELECT * FROM journal_lines WHERE journal_id IN (${js.map(j => Number(j.id)).join(',')}) ORDER BY id`);
    return js.map(j => ({ ...j, lines: lines.filter(l => l.journal_id === j.id) }));
  }

  // ---------- dự toán công trình ----------
  saveBudget({ user, body, ip }, id) {
    this.need(user, BOOKKEEPERS);
    const pj = this.db.one(`SELECT id, version FROM projects WHERE id = ?`, id);
    if (!pj) throw new HttpError(404, 'Không tìm thấy công trình');
    checkVersion(body, pj.version, 'Dự toán công trình');
    const lines = body.lines && typeof body.lines === 'object' ? body.lines : {};
    const next = {};
    for (const k of Object.keys(PROJECT_CATEGORIES)) next[k] = toMoney(lines[k] ?? 0, { field: 'Dự toán ' + PROJECT_CATEGORIES[k] });
    const before = this.db.all(`SELECT category, amount FROM budgets WHERE project_id = ?`, id);
    this.db.tx(() => {
      this.db.run(`DELETE FROM budgets WHERE project_id = ?`, id);
      this.db.run(`UPDATE projects SET version = version + 1 WHERE id = ?`, id);
      Object.entries(next).forEach(([k, v]) => { if (v) this.db.run(`INSERT INTO budgets (project_id, category, amount) VALUES (?, ?, ?)`, id, k, v); });
    });
    this.audit(user, 'du_toan', 'cong_trinh', id, before, next, ip);
    return { ok: true };
  }

  // ---------- tạm ứng (TK 141) ----------
  listAdvances({ user, q }) {
    const where = [], args = [];
    if (user.role === 'chi_huy') { where.push('user_id = ?'); args.push(user.id); }
    if (q.month && isMonth(q.month)) { where.push('date BETWEEN ? AND ?'); args.push(q.month + '-01', monthEnd(q.month)); }
    const items = this.db.all(`SELECT x.*, (SELECT COUNT(*) FROM attachments a WHERE a.owner_type = 'advances' AND a.owner_id = x.id) AS files FROM advances x ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, id DESC LIMIT 2000`, ...args);
    let bal = advanceBalances(this.ledgerData(), this.db.all(`SELECT pay_method, advance_user_id, amount_net, vat, pit FROM costs WHERE status = 'cho_duyet'`));
    if (user.role === 'chi_huy') bal = bal.filter(b => b.user_id === user.id);
    return { items, balances: bal };
  }
  createAdvance({ user, body, ip }) {
    this.need(user, BOOKKEEPERS);
    const date = body.date;
    if (!body.allow_duplicate) {
      const d = this.db.one(`SELECT code FROM advances WHERE date = ? AND user_id = ? AND kind = ? AND amount = ? AND reverses_id IS NULL AND created_at >= ?`,
        date, Number(body.user_id), String(body.kind), Math.round(Number(String(body.amount).replace(/[.\s,đ]/g, '')) || 0), vnNow(this.now() - 30 * 60000));
      if (d) throw dupError(`Có vẻ trùng với ${d.code} vừa nhập. Vẫn lưu?`);
    }
    this.assertDate(date, 'Ngày');
    this.assertOpen(date);
    const userId = Number(body.user_id);
    if (!this.db.one(`SELECT id FROM users WHERE id = ?`, userId)) throw bad('Chọn người nhận tạm ứng');
    const kind = oneOf(body.kind, ADVANCE_KIND, 'Loại');
    const amount = toMoney(body.amount, { field: 'Số tiền' });
    if (amount <= 0) throw bad('Số tiền phải lớn hơn 0');
    const method = oneOf(body.method, CASH_METHODS, 'Hình thức');
    const description = str(body.description, { field: 'nội dung', max: 500 });
    const atts = this.validAttachments(body.attachments, false);
    let row;
    this.db.tx(() => {
      row = this.db.one(`INSERT INTO advances (code, date, user_id, kind, amount, method, description, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'da_duyet', ?, ?) RETURNING id, code`,
        this.nextCode('TU'), date, userId, kind, amount, method, description, user.id, vnNow(this.now()));
      this.saveAttachments(user, 'advances', row.id, atts);
      this.audit(user, 'tao', 'tam_ung', row.code, null, { date, userId, kind, amount, method, description }, ip);
    });
    return row;
  }

  // ---------- bút toán khác & số dư đầu kỳ ----------
  listJournals({ user, q }) {
    this.need(user, VIEWERS);
    if (q.month && isMonth(q.month)) return { items: this.journalsWithLines(`WHERE date BETWEEN ? AND ?`, q.month + '-01', monthEnd(q.month)).reverse() };
    return { items: this.journalsWithLines('').reverse().slice(0, 500) };
  }
  createJournal({ user, body, ip }) {
    this.need(user, BOOKKEEPERS);
    const kind = oneOf(body.kind || 'khac', { khac: 1, dau_ky: 1 }, 'Loại bút toán');
    const date = body.date;
    this.assertDate(date, 'Ngày');
    this.assertOpen(date);
    const description = str(body.description, { field: 'diễn giải', required: true, max: 500 });
    const allowed = kind === 'dau_ky' ? OPENING_ACCOUNTS : MANUAL_ACCOUNTS;
    const lines = (Array.isArray(body.lines) ? body.lines : []).map(l => {
      const acc = String(l.acc || '');
      if (!allowed.includes(acc)) throw bad(`Tài khoản ${acc || '(trống)'} không dùng được trong ${kind === 'dau_ky' ? 'số dư đầu kỳ' : 'bút toán khác'}. Chi phí/doanh thu công trình phải nhập qua mục Chi phí/Doanh thu.`);
      const debit = toMoney(l.debit || 0, { field: 'Số tiền Nợ' }), credit = toMoney(l.credit || 0, { field: 'Số tiền Có' });
      if ((debit > 0) === (credit > 0)) throw bad('Mỗi dòng chỉ ghi một bên Nợ hoặc Có');
      return { acc, obj: str(l.obj, { field: 'đối tượng', max: 100 }), debit, credit };
    });
    if (lines.length < 2) throw bad('Bút toán cần ít nhất 2 dòng');
    if (lines.length > 50) throw bad('Tối đa 50 dòng');
    const d = lines.reduce((a, l) => a + l.debit, 0), c = lines.reduce((a, l) => a + l.credit, 0);
    if (d !== c) throw bad(`Tổng Nợ (${d.toLocaleString('vi-VN')}) phải bằng tổng Có (${c.toLocaleString('vi-VN')})`);
    const atts = this.validAttachments(body.attachments, false);
    let row;
    this.db.tx(() => {
      row = this.db.one(`INSERT INTO journals (code, date, kind, description, status, created_by, created_at) VALUES (?, ?, ?, ?, 'da_duyet', ?, ?) RETURNING id, code`,
        this.nextCode('BT'), date, kind, description, user.id, vnNow(this.now()));
      lines.forEach(l => this.db.run(`INSERT INTO journal_lines (journal_id, acc, obj, debit, credit) VALUES (?, ?, ?, ?, ?)`, row.id, l.acc, l.obj, l.debit, l.credit));
      this.saveAttachments(user, 'journals', row.id, atts);
      this.audit(user, 'tao', 'but_toan', row.code, null, { date, kind, description, lines }, ip);
    });
    return row;
  }

  // ---------- sổ sách ----------
  reportTrial({ user, q }) {
    this.need(user, VIEWERS);
    if (!isMonth(q.m)) throw bad('Tháng không hợp lệ');
    return trialBalance(this.ledgerData(), q.m);
  }
  reportLedger({ user, q }) {
    this.need(user, VIEWERS);
    if (!isMonth(q.m)) throw bad('Tháng không hợp lệ');
    if (!ACCOUNTS[q.acc]) throw bad('Tài khoản không hợp lệ');
    return ledger(this.ledgerData(), q.acc, q.m);
  }
  reportTax({ user, q }) {
    this.need(user, VIEWERS);
    if (!isMonth(q.m)) throw bad('Tháng không hợp lệ');
    return taxReport(this.ledgerData(), q.m);
  }

  listAudit({ user, q }) {
    this.need(user, VIEWERS);
    const before = Number(q.before) || 1e15;
    const where = ['id < ?'], args = [before];
    if (q.entity) { where.push('entity = ?'); args.push(String(q.entity)); }
    return { items: this.db.all(`SELECT * FROM audit WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 200`, ...args) };
  }
}
