// Giao diện Sổ Công Trình (không dùng thư viện ngoài). Mọi dữ liệu hiển thị đều qua esc() để chống chèn mã.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const S = { boot: null, status: null };

// ---------- tiện ích ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (Number(n) || 0).toLocaleString('vi-VN');
const money = (n) => `<span class="num ${n < 0 ? 'neg' : ''}">${fmt(n)}</span>`;
const parseMoney = (s) => Math.round(Number(String(s ?? '').replace(/[^\d-]/g, '')) || 0);
const pctTxt = (p) => `${(Number(p) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
const dmy = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const my = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const today = () => S.boot?.today || S.status?.today || new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
function prevMonth(m) { let [y, mo] = m.split('-').map(Number); mo -= 1; if (!mo) { mo = 12; y -= 1; } return `${y}-${String(mo).padStart(2, '0')}`; }
const C = () => S.boot.constants;
const me = () => S.boot.me;
const role = () => me().role;
const can = (...roles) => roles.includes(role());
const projName = (id) => { const p = S.boot.projects.find(x => x.id === id); return p ? `${p.code} · ${p.name}` : '— Chi phí chung —'; };
const projCode = (id) => S.boot.projects.find(x => x.id === id)?.code || 'Chung';
const partnerName = (id) => S.boot.partners.find(x => x.id === id)?.name || '';
const userName = (id) => S.boot.users.find(x => x.id === id)?.full_name || (id ? `#${id}` : '');

// Mỗi thao tác ghi mang 1 mã chống trùng (x-idem): bấm 2 lần hoặc mạng gửi lại thì máy chủ chỉ thực hiện 1 lần.
const newIdem = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).replace(/[^A-Za-z0-9_-]/g, '');
let IDEM = null;
async function api(method, path, body) {
  const opt = { method, headers: { 'x-sct': '1' }, credentials: 'same-origin' };
  if (method !== 'GET') opt.headers['x-idem'] = IDEM || newIdem();
  if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opt); } catch {
    // mất mạng giữa chừng: gửi lại đúng 1 lần với CÙNG mã → nếu lần đầu đã tới máy chủ thì không bị ghi 2 lần
    await new Promise(r => setTimeout(r, 1500));
    try { res = await fetch(path, opt); } catch { throw new Error('Mất kết nối mạng. Kiểm tra mạng rồi thử lại (không lo bị ghi trùng).'); }
  }
  let data = null;
  try { data = await res.json(); } catch { data = {}; }
  if (res.status === 401 && !['/api/login', '/api/setup', '/api/me/password'].includes(path)) { S.boot = null; showAuth(); throw new Error(data.error || 'Cần đăng nhập'); }
  if (res.status === 409 && data.code === 'possible_duplicate' && body && typeof body === 'object') {
    if (confirm(data.error)) return api(method, path, { ...body, allow_duplicate: true });
    const e = new Error('Đã huỷ, không lưu.'); e.code = 'cancelled'; throw e;
  }
  if (!res.ok) { const e = new Error(data.error || `Lỗi ${res.status}`); e.code = data.code; throw e; }
  return data;
}
// Dữ liệu vừa bị người khác sửa → tải lại bản mới nhất.
async function onConflict(e) {
  if (e && e.code === 'conflict') { closeModal(); try { await loadBoot(); } catch { /* bỏ qua */ } route(); }
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3000);
}

function openModal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modalBack').hidden = false;
  const first = $('#modalBody input:not([type=hidden]), #modalBody select, #modalBody textarea');
  if (first) setTimeout(() => { if (!$('#modalBody').contains(document.activeElement)) first.focus(); }, 30);
  return $('#modalBody');
}
function closeModal() { $('#modalBack').hidden = true; $('#modalBody').innerHTML = ''; }
$('#modalClose').addEventListener('click', closeModal);
$('#modalBack').addEventListener('click', (e) => { if (e.target.id === 'modalBack') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modalBack').hidden) closeModal(); });

// Định dạng ô nhập tiền 1.234.567 khi gõ
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.matches('input[data-money]')) return;
  const neg = el.value.trim().startsWith('-') && el.hasAttribute('data-allow-neg');
  const digits = el.value.replace(/\D/g, '');
  el.value = digits ? (neg ? '-' : '') + Number(digits).toLocaleString('vi-VN') : (neg ? '-' : '');
});

function formValues(form) {
  const v = {};
  $$('[name]', form).forEach(el => {
    if (el.type === 'file') return;
    if (el.type === 'checkbox') v[el.name] = el.checked;
    else if (el.hasAttribute('data-money')) v[el.name] = parseMoney(el.value);
    else v[el.name] = el.value;
  });
  return v;
}
async function submitting(form, fn) {
  const btn = $('button[type=submit]', form);
  if (form.dataset.busy === '1') return; // đang gửi: bỏ qua lần bấm thứ 2
  form.dataset.busy = '1';
  const errBox = $('.form-error', form);
  if (errBox) errBox.hidden = true;
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Đang lưu…'; }
  if (!form.dataset.idem) form.dataset.idem = newIdem(); // cùng 1 form = cùng 1 mã, gửi lại không bị ghi trùng
  IDEM = form.dataset.idem;
  try { await fn(); } catch (e) {
    if (e.code === 'conflict') { toast(e.message, true); await onConflict(e); return; }
    if (errBox) { errBox.textContent = e.message; errBox.hidden = false; errBox.scrollIntoView({ block: 'nearest' }); } else toast(e.message, true);
  } finally { IDEM = null; form.dataset.busy = ''; syncSeq(); if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
}
// Nút thao tác 1 lần (duyệt, huỷ, ký…): khoá nút khi đang gửi.
async function once(btn, fn) {
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  IDEM = newIdem();
  try { await fn(); } catch (e) { toast(e.message, true); await onConflict(e); } finally { IDEM = null; syncSeq(); if (btn) btn.disabled = false; }
}

// Ảnh chứng từ: tự nén về JPEG ≤1600px để vừa giới hạn lưu trữ, PDF/XML giữ nguyên.
async function readFiles(input) {
  const out = [];
  for (const f of input.files) {
    let blob = f, mime = f.type || 'application/octet-stream', name = f.name;
    if (/^image\//.test(mime)) {
      try {
        const bmp = await createImageBitmap(f);
        const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
        mime = 'image/jpeg'; name = name.replace(/\.[^.]+$/, '') + '.jpg';
      } catch { /* trình duyệt không đọc được (vd HEIC) → gửi nguyên file */ }
    }
    if (/\.xml$/i.test(name) && !/xml/.test(mime)) mime = 'application/xml';
    if (blob.size > 1900 * 1024) throw new Error(`File "${name}" quá lớn (tối đa 1,9MB). Hãy chụp lại hoặc chia nhỏ PDF.`);
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
    out.push({ name, mime, data });
  }
  return out;
}

function csvDownload(filename, rows) {
  const text = '﻿' + rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function options(map, selected, { empty } = {}) {
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    Object.entries(map).map(([k, v]) => `<option value="${esc(k)}" ${String(k) === String(selected ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('');
}
const projectOptions = (selected, { includeOverhead = true, onlyOpen = true } = {}) =>
  (includeOverhead ? `<option value="">— Chi phí chung (không thuộc công trình) —</option>` : '<option value="">— Chọn công trình —</option>') +
  S.boot.projects.filter(p => !onlyOpen || p.status !== 'huy' || p.id === Number(selected))
    .map(p => `<option value="${p.id}" ${p.id === Number(selected) ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}${p.status === 'da_nghiem_thu' ? ' (đã nghiệm thu)' : ''}</option>`).join('');
const partnerOptions = (selected, empty = '— Chọn —') => `<option value="">${esc(empty)}</option>` +
  S.boot.partners.map(p => `<option value="${p.id}" ${p.id === Number(selected) ? 'selected' : ''}>${esc(p.name)}${p.mst ? ' · ' + esc(p.mst) : ''}</option>`).join('');
const monthInput = (id, val) => `<input type="month" id="${id}" value="${esc(val)}" max="${thisMonth()}">`;

function costPill(c) {
  if (c.reverses_id) return '<span class="pill gray">Bút toán đảo</span>';
  if (c.reversed_by_id) return '<span class="pill gray">Đã huỷ</span>';
  const cls = { cho_duyet: 'warn', da_duyet: 'ok', tu_choi: 'bad' }[c.status] || 'gray';
  return `<span class="pill ${cls}">${esc(C().COST_STATUS[c.status] || c.status)}</span>`;
}
const projectPill = (s) => `<span class="pill ${{ dang_thi_cong: 'warn', da_nghiem_thu: 'ok', tam_dung: 'gray', huy: 'bad' }[s] || 'gray'}">${esc(C().PROJECT_STATUS[s] || s)}</span>`;

// ---------- khung & điều hướng ----------
const NAV = [
  { href: '#/', label: 'Tổng quan', roles: ['quan_tri', 'ke_toan', 'chi_huy', 'co_dong'] },
  { href: '#/duyet', label: 'Chờ duyệt', roles: ['quan_tri', 'ke_toan', 'co_dong'], badge: true },
  { href: '#/chi-phi', label: 'Chi phí', roles: ['quan_tri', 'ke_toan', 'chi_huy', 'co_dong'] },
  { href: '#/cong-trinh', label: 'Công trình', roles: ['quan_tri', 'ke_toan', 'co_dong'] },
  { href: '#/doanh-thu', label: 'Doanh thu & thu tiền', roles: ['quan_tri', 'ke_toan', 'co_dong'] },
  { href: '#/cong-no', label: 'Công nợ & trả NCC', roles: ['quan_tri', 'ke_toan', 'co_dong'] },
  { href: '#/tam-ung', label: 'Tạm ứng', roles: ['quan_tri', 'ke_toan', 'co_dong', 'chi_huy'] },
  { sep: true },
  { href: '#/bao-cao', label: 'Báo cáo tháng', roles: ['quan_tri', 'ke_toan', 'co_dong'] },
  { href: '#/so-nhat-ky', label: 'Sổ nhật ký (TT133)', roles: ['quan_tri', 'ke_toan', 'co_dong'] },
  { href: '#/thue', label: 'Thuế & bảng kê', roles: ['quan_tri', 'ke_toan', 'co_dong'] },
  { href: '#/so-cai', label: 'Cân đối & sổ cái, sổ quỹ', roles: ['quan_tri', 'ke_toan', 'co_dong'] },
  { href: '#/but-toan', label: 'Bút toán khác & số dư đầu kỳ', roles: ['quan_tri', 'ke_toan', 'co_dong'] },
  { href: '#/nhat-ky', label: 'Nhật ký thao tác', roles: ['quan_tri', 'ke_toan', 'co_dong'] },
  { sep: true },
  { href: '#/doi-tac', label: 'Nhà cung cấp & khách', roles: ['quan_tri', 'ke_toan'] },
  { href: '#/cai-dat', label: 'Cài đặt & người dùng', roles: ['quan_tri'] },
  { href: '#/cai-ung-dung', label: 'Cài ứng dụng lên máy', roles: ['quan_tri', 'ke_toan', 'chi_huy', 'co_dong'], install: true },
  { href: '#/tai-khoan', label: 'Mật khẩu & máy đăng nhập', roles: ['quan_tri', 'ke_toan', 'chi_huy', 'co_dong'] },
  { href: '#/dang-xuat', label: 'Đăng xuất', roles: ['quan_tri', 'ke_toan', 'chi_huy', 'co_dong'] },
];
let pendingCount = 0;
function renderNav() {
  const hash = location.hash || '#/';
  $('#sidebar').innerHTML = NAV.filter(n => n.sep || (n.roles.includes(role()) && (!n.install || !isStandalone()))).map(n => n.sep ? '<div class="sep"></div>' :
    `<a href="${n.href}" class="${(hash === n.href || (n.href !== '#/' && hash.startsWith(n.href))) ? 'active' : ''}"><span>${esc(n.label)}</span>${n.badge && pendingCount ? `<span class="badge">${pendingCount}</span>` : ''}</a>`).join('');
}
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) $('#sidebar').classList.remove('open'); });

async function loadBoot() {
  const [boot, ch] = await Promise.all([api('GET', '/api/bootstrap'), api('GET', '/api/changes').catch(() => null)]);
  S.boot = boot;
  if (ch) lastSeq = ch.seq;
  $('#companyName').textContent = S.boot.settings.company_name || 'Sổ Công Trình';
  document.title = `Sổ Công Trình — ${S.boot.settings.company_name || ''}`;
  $('#who').textContent = `${me().full_name} · ${C().ROLES[role()]}`;
  $('#topbar').hidden = false; $('#sidebar').hidden = false;
}

const ROUTES = [
  [/^#?\/?$/, pageDashboard],
  [/^#\/duyet$/, pageApprovals],
  [/^#\/chi-phi$/, pageCosts],
  [/^#\/chi-phi\/(\d+)$/, pageCostDetail],
  [/^#\/cong-trinh$/, pageProjects],
  [/^#\/cong-trinh\/(\d+)$/, pageProjectDetail],
  [/^#\/doanh-thu$/, pageRevenues],
  [/^#\/cong-no$/, pageBalances],
  [/^#\/bao-cao$/, pageReport],
  [/^#\/so-nhat-ky$/, pageJournal],
  [/^#\/nhat-ky$/, pageAudit],
  [/^#\/doi-tac$/, pagePartners],
  [/^#\/cai-dat$/, pageSettings],
  [/^#\/tai-khoan$/, pageAccount],
  [/^#\/cai-ung-dung$/, pageInstall],
  [/^#\/tam-ung$/, pageAdvances],
  [/^#\/thue$/, pageTax],
  [/^#\/so-cai$/, pageTrial],
  [/^#\/but-toan$/, pageJournals],
  [/^#\/dang-xuat$/, doLogout],
];
async function route(opts) {
  if (!S.boot) return;
  const keepScroll = !!(opts && opts.keepScroll), y = window.scrollY;
  const hash = location.hash || '#/';
  renderNav();
  const main = $('#main');
  for (const [re, fn] of ROUTES) {
    const m = re.exec(hash);
    if (m) {
      if (!keepScroll) main.innerHTML = '<div class="loading">Đang tải…</div>';
      try { await fn(main, ...m.slice(1)); } catch (e) { main.innerHTML = `<div class="card"><div class="notice bad">${esc(e.message)}</div></div>`; }
      window.scrollTo(0, keepScroll ? y : 0);
      return;
    }
  }
  main.innerHTML = '<div class="card">Không tìm thấy trang.</div>';
}
window.addEventListener('hashchange', route);
async function refreshPending() {
  if (!can('quan_tri', 'ke_toan', 'co_dong')) return;
  try { const r = await api('GET', '/api/costs?status=cho_duyet&limit=500'); pendingCount = r.items.length; renderNav(); } catch { /* bỏ qua */ }
}

// ---------- đăng nhập / thiết lập ----------
async function start() {
  try { S.status = await api('GET', '/api/status'); } catch (e) { $('#main').innerHTML = `<div class="auth"><div class="card notice bad">Không kết nối được máy chủ: ${esc(e.message)}</div></div>`; return; }
  if (!S.status.setup_done) return showSetup();
  try { await loadBoot(); } catch { return showAuth(); }
  await refreshPending();
  route();
}

function showAuth() {
  $('#topbar').hidden = true; $('#sidebar').hidden = true;
  $('#main').innerHTML = `<div class="auth"><div class="card">
    <h1>Đăng nhập</h1><p class="muted">Sổ Công Trình — kế toán và bóc tách chi phí công trình</p>
    <form id="loginForm"><div class="form-error" hidden></div>
      <label>Tên đăng nhập</label><input name="username" autocomplete="username" required autocapitalize="none">
      <label class="mt">Mật khẩu</label><input name="password" type="password" autocomplete="current-password" required>
      <div class="form-actions"><button class="btn primary" type="submit">Đăng nhập</button></div>
    </form></div></div>`;
  const f = $('#loginForm');
  f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => { await api('POST', '/api/login', formValues(f)); await loadBoot(); await refreshPending(); location.hash = '#/'; route(); }); });
}

function showSetup() {
  $('#topbar').hidden = true; $('#sidebar').hidden = true;
  $('#main').innerHTML = `<div class="auth"><div class="card">
    <h1>Thiết lập lần đầu</h1>
    <p class="muted">Nhập thông tin công ty và tạo tài khoản Quản trị. Bước này chỉ làm một lần.</p>
    <form id="setupForm"><div class="form-error" hidden></div>
      <h3>Công ty</h3>
      <label>Tên công ty (theo đăng ký kinh doanh)</label><input name="company_name" required>
      <div class="form-grid"><div><label>Mã số thuế</label><input name="company_mst" inputmode="numeric"></div>
      <div><label>Địa chỉ</label><input name="company_address"></div></div>
      <h3>Cổ đông và tỷ lệ góp vốn</h3>
      <div id="shRows"></div><button type="button" class="btn sm" id="addSh">+ Thêm cổ đông</button>
      <div class="field-hint">Tổng tỷ lệ phải đúng 100%. Lãi ròng hằng tháng tự chia theo tỷ lệ này.</div>
      <h3>Tài khoản Quản trị</h3>
      <div class="form-grid"><div><label>Họ tên</label><input name="admin_full_name" required></div>
      <div><label>Tên đăng nhập</label><input name="admin_username" required autocapitalize="none" placeholder="vd: admin"></div>
      <div class="full"><label>Mật khẩu (≥ 8 ký tự, có chữ và số)</label><input name="admin_password" type="password" autocomplete="new-password" required></div></div>
      <div class="form-actions"><button class="btn primary" type="submit">Hoàn tất thiết lập</button></div>
    </form></div></div>`;
  const rows = $('#shRows');
  const addRow = (name = '', pct = '') => {
    const d = document.createElement('div'); d.className = 'form-grid sh-row';
    d.innerHTML = `<div><label>Tên cổ đông</label><input class="sh-name" value="${esc(name)}"></div><div><label>Tỷ lệ %</label><input class="sh-pct" inputmode="decimal" value="${esc(pct)}"></div>`;
    rows.appendChild(d);
  };
  addRow(); addRow();
  $('#addSh').addEventListener('click', () => addRow());
  const f = $('#setupForm');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(f, async () => {
      const v = formValues(f);
      v.shareholders = $$('.sh-row', f).map(r => ({ name: $('.sh-name', r).value, pct: $('.sh-pct', r).value })).filter(s => s.name.trim());
      await api('POST', '/api/setup', v);
      await loadBoot(); location.hash = '#/'; route();
      toast('Đã thiết lập xong. Vào "Cài đặt & người dùng" để tạo tài khoản cho kế toán, chỉ huy, cổ đông.');
    });
  });
}

async function doLogout() {
  try { await api('POST', '/api/logout', {}); } catch { /* bỏ qua */ }
  S.boot = null; location.hash = '#/'; showAuth();
}

// ---------- Tổng quan ----------
async function pageDashboard(main) {
  const d = await api('GET', '/api/dashboard');
  const pendingHtml = d.pending.length ? `<div class="table-wrap"><table><thead><tr><th>Mã</th><th>Ngày</th><th>Công trình</th><th>Nội dung</th><th class="num">Tổng tiền</th></tr></thead><tbody>
    ${d.pending.map(c => `<tr class="clickable" data-go="#/chi-phi/${c.id}"><td>${esc(c.code)}</td><td>${dmy(c.date)}</td><td>${esc(projCode(c.project_id))}</td><td>${esc(c.description)}</td><td class="num">${fmt(c.amount_net + c.vat)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Không có khoản nào chờ duyệt.</p>';
  if (d.chi_huy) {
    main.innerHTML = `<div class="page-head"><div><h1>Xin chào, ${esc(me().full_name)}</h1><p class="muted">Nhập chi phí công trình kèm ảnh chứng từ. Kế toán hoặc cổ đông sẽ duyệt.</p></div>
      <div class="actions"><button class="btn primary" id="btnAddCost">+ Nhập chi phí</button><button class="btn" id="btnXml">Nhập hoá đơn XML</button></div></div>
      ${d.advance ? `<div class="kpis"><div class="kpi"><div class="l">Tiền tạm ứng còn giữ</div><div class="v">${fmt(d.advance.balance)}</div><div class="l">${d.advance.pending ? 'Đang chờ duyệt chi: ' + fmt(d.advance.pending) : ''}</div></div></div>` : ''}
      <div class="card"><h2>Khoản bạn đã nhập đang chờ duyệt</h2>${pendingHtml}</div>`;
  } else {
    const r = d.report;
    main.innerHTML = `<div class="page-head"><div><h1>Tổng quan tháng ${my(d.month)}</h1><p class="muted">Số liệu đã ghi sổ (không gồm khoản chờ duyệt). ${d.locked_through ? `Đã khoá sổ đến ${my(d.locked_through)}.` : 'Chưa khoá sổ tháng nào.'}</p></div>
      <div class="actions">${can('quan_tri', 'ke_toan') ? '<button class="btn primary" id="btnAddCost">+ Nhập chi phí</button><button class="btn" id="btnXml">Nhập hoá đơn XML</button>' : ''}<a class="btn" href="#/bao-cao">Báo cáo tháng</a></div></div>
      <div class="kpis">
        <div class="kpi"><div class="l">Doanh thu tháng (trước thuế)</div><div class="v">${fmt(r.totals.revenue)}</div></div>
        <div class="kpi"><div class="l">Chi phí tháng (trước thuế)</div><div class="v">${fmt(r.totals.cost)}</div></div>
        <div class="kpi"><div class="l">Chi phí dở dang (TK 154)</div><div class="v">${fmt(r.wip)}</div></div>
        <div class="kpi"><div class="l">Lãi ròng tạm tính tháng</div><div class="v ${r.net < 0 ? 'neg' : ''}">${fmt(r.net)}</div></div>
        <div class="kpi"><div class="l">Chờ duyệt</div><div class="v">${d.pending.length}</div></div>
      </div>
      <div class="card"><h2>Khoản chi chờ duyệt</h2>${pendingHtml}</div>
      <div class="card"><h2>Công trình phát sinh trong tháng</h2>${reportProjectsTable(r, false)}</div>`;
  }
  bindCommon(main);
}

function bindCommon(root) {
  $$('[data-go]', root).forEach(el => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) location.hash = el.dataset.go; }));
  $('#btnAddCost', root)?.addEventListener('click', () => costForm());
  $('#btnXml', root)?.addEventListener('click', () => xmlForm());
}

// ---------- Chi phí ----------
const EVIDENCE_HINT = {
  hoa_don_gtgt: 'Đính kèm ảnh/PDF hoá đơn GTGT (hoặc dùng "Nhập hoá đơn XML" để tự đọc).',
  hoa_don_ban_hang: 'Đính kèm hoá đơn bán hàng. Không có thuế GTGT được khấu trừ.',
  bang_ke: 'Mua của người bán lẻ/hộ không có hoá đơn (cát, đá, dây buộc…): chụp giấy biên nhận có họ tên, địa chỉ, chữ ký người bán (kèm CCCD nếu có). Khoản này tự lên Bảng kê 01/TNDN, vẫn được tính chi phí.',
  nhan_cong_khoan: 'Thuê thợ cá nhân không có hoá đơn: chụp hợp đồng khoán + biên nhận tiền (ký tên) + CCCD. Lần trả từ 2 triệu tự khấu trừ 10% thuế TNCN, trừ khi người lao động có cam kết mẫu 08/CK-TNCN.',
  noi_bo: 'Chứng từ nội bộ: bảng lương có ký nhận, phiếu chi, quyết định… ',
  khong_hop_le: 'Không có chứng từ hợp lệ: vẫn ghi để quản lý tiền, nhưng KHÔNG được trừ khi tính thuế TNDN. Vẫn phải chụp ảnh bằng chứng (tin nhắn, ảnh chụp…).',
};
async function quickPartner(selectEl, needPersonal) {
  const name = prompt(needPersonal ? 'Họ tên người bán / người nhận tiền:' : 'Tên nhà cung cấp / người nhận:');
  if (!name) return;
  const address = prompt('Địa chỉ:') || '';
  const id_no = needPersonal ? (prompt('Số CCCD (để lên bảng kê):') || '') : '';
  const mst = needPersonal ? '' : (prompt('Mã số thuế (bỏ trống nếu không có):') || '');
  try {
    const r = await api('POST', '/api/partners', { kind: 'ncc', name, mst, address, id_no });
    S.boot.partners.push({ id: r.id, kind: 'ncc', name, mst, address, id_no });
    selectEl.innerHTML = partnerOptions(r.id, '— Không có / chọn —');
  } catch (err) { toast(err.message, true); }
}
function showWarnings(r) {
  if (r && r.warnings && r.warnings.length) setTimeout(() => alert('Lưu ý:\n\n• ' + r.warnings.join('\n• ')), 300);
}
function costForm(existing) {
  const c = existing || { date: today(), pay_method: role() === 'chi_huy' ? 'tam_ung' : 'chuyen_khoan', category: '', evidence: 'hoa_don_gtgt' };
  const isChiHuy = role() === 'chi_huy';
  const body = openModal(existing ? `Sửa ${existing.code}` : 'Nhập chi phí', `<form id="costForm"><div class="form-error" hidden></div>
    <div class="form-grid">
      <div><label>Ngày chứng từ</label><input type="date" name="date" value="${esc(c.date)}" max="${today()}" required></div>
      <div><label>Công trình</label><select name="project_id">${projectOptions(c.project_id, { includeOverhead: !isChiHuy })}</select></div>
      <div><label>Loại chi phí</label><select name="category" id="catSel"></select></div>
      <div><label>Loại chứng từ</label><select name="evidence" id="evSel">${options(C().EVIDENCE, c.evidence || 'hoa_don_gtgt')}</select></div>
      <div class="full"><div class="notice small" id="evHint"></div></div>
      <div><label id="partnerLbl">Nhà cung cấp / người nhận</label><select name="partner_id" id="partnerSel">${partnerOptions(c.partner_id, '— Không có / chọn —')}</select>
        <a href="#" class="small" id="addPartner">+ Thêm mới</a></div>
      <div><label>Số hoá đơn / số chứng từ</label><input name="invoice_no" value="${esc(c.invoice_no || '')}"></div>
      <div class="full"><label>Nội dung</label><input name="description" value="${esc(c.description || '')}" required placeholder="vd: Nhân công lắp đặt 3 ngày, 4 người"></div>
      <div><label id="netLbl">Tiền trước thuế (đồng)</label><input name="amount_net" data-money inputmode="numeric" value="${c.amount_net ? fmt(c.amount_net) : ''}" required></div>
      <div id="vatBox"><label>Thuế GTGT</label><div class="actions"><select id="vatRate"><option value="">Tự nhập</option><option value="0">0%</option><option value="5">5%</option><option value="8">8%</option><option value="10">10%</option></select>
        <input name="vat" data-money inputmode="numeric" value="${c.vat ? fmt(c.vat) : '0'}"></div></div>
      <div id="pitBox" hidden><label>Thuế TNCN khấu trừ</label><input name="pit" data-money inputmode="numeric" value="${c.pit ? fmt(c.pit) : ''}">
        <label class="check mt"><input type="checkbox" name="pit_exempt"> Người lao động có cam kết 08/CK-TNCN (không khấu trừ)</label></div>
      <div><label>Thanh toán</label><select name="pay_method" id="paySel">${options(C().PAY_METHODS, c.pay_method)}</select></div>
      ${isChiHuy ? '' : `<div id="advBox" hidden><label>Người đã chi bằng tiền tạm ứng</label><select name="advance_user_id">${S.boot.users.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === (c.advance_user_id || me().id) ? 'selected' : ''}>${esc(u.full_name)}</option>`).join('')}</select></div>`}
      ${existing ? '' : `<div class="full"><label>Ảnh/file chứng từ (bắt buộc)</label><input type="file" id="costFiles" accept="image/*,application/pdf" multiple required>
        <div class="field-hint">Có thể chụp trực tiếp bằng điện thoại, chọn nhiều ảnh. Ảnh tự nén cho nhẹ.</div></div>`}
      <div class="full"><div class="small muted" id="totalHint"></div></div>
    </div>
    <div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">${existing ? 'Lưu' : 'Lưu chi phí'}</button></div></form>`);
  const f = $('#costForm', body);
  const projSel = $('[name=project_id]', f), catSel = $('#catSel', f), evSel = $('#evSel', f), paySel = $('#paySel', f);
  const fillCats = () => {
    const isProj = !!projSel.value;
    const map = isProj ? C().PROJECT_CATEGORIES : C().OVERHEAD_CATEGORIES;
    const cur = catSel.value || c.category;
    catSel.innerHTML = options(map, map[cur] ? cur : Object.keys(map)[isProj ? 2 : 0]);
  };
  fillCats();
  projSel.addEventListener('change', fillCats);
  const net = $('[name=amount_net]', f), vat = $('[name=vat]', f), rate = $('#vatRate', f), pit = $('[name=pit]', f), pitEx = $('[name=pit_exempt]', f);
  let pitTouched = !!c.pit;
  const recalc = () => {
    const ev = evSel.value;
    if (ev !== 'hoa_don_gtgt') vat.value = '0';
    else if (rate.value !== '') vat.value = fmt(Math.round(parseMoney(net.value) * Number(rate.value) / 100));
    if (ev === 'nhan_cong_khoan' && !pitTouched) {
      const n = parseMoney(net.value), st = S.boot.settings;
      pit.value = !pitEx.checked && n >= Number(st.pit_threshold) ? fmt(Math.round(n * Number(st.pit_rate) / 100)) : '0';
    }
    const p = ev === 'nhan_cong_khoan' && !pitEx.checked ? parseMoney(pit.value) : 0;
    const total = parseMoney(net.value) + parseMoney(vat.value);
    $('#totalHint', f).textContent = `Tổng chi phí: ${fmt(total)} đ${p ? ` · Khấu trừ TNCN ${fmt(p)} đ · Thực trả người lao động: ${fmt(total - p)} đ` : ''}`;
  };
  const onEvidence = () => {
    const ev = evSel.value;
    $('#evHint', f).textContent = EVIDENCE_HINT[ev] || '';
    $('#vatBox', f).hidden = ev !== 'hoa_don_gtgt';
    $('#pitBox', f).hidden = ev !== 'nhan_cong_khoan';
    $('#partnerLbl', f).textContent = ['bang_ke', 'nhan_cong_khoan'].includes(ev) ? 'Người bán / người nhận tiền (cá nhân)' : 'Nhà cung cấp / người nhận';
    $('#netLbl', f).textContent = ev === 'hoa_don_gtgt' ? 'Tiền trước thuế (đồng)' : ev === 'nhan_cong_khoan' ? 'Tiền công (trước khấu trừ TNCN)' : 'Số tiền (đồng)';
    if (ev === 'nhan_cong_khoan' && catSel.querySelector('option[value=nhan_cong]')) catSel.value = 'nhan_cong';
    recalc();
  };
  evSel.addEventListener('change', onEvidence);
  const onPay = () => { const b = $('#advBox', f); if (b) b.hidden = paySel.value !== 'tam_ung'; };
  paySel.addEventListener('change', onPay); onPay();
  net.addEventListener('input', recalc); rate.addEventListener('change', recalc); vat.addEventListener('input', () => { rate.value = ''; recalc(); });
  pit.addEventListener('input', () => { pitTouched = true; recalc(); }); pitEx.addEventListener('change', () => { pitTouched = false; recalc(); });
  onEvidence();
  $('[data-close]', f).addEventListener('click', closeModal);
  $('#addPartner', f).addEventListener('click', (e) => { e.preventDefault(); quickPartner($('#partnerSel', f), ['bang_ke', 'nhan_cong_khoan'].includes(evSel.value)); });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(f, async () => {
      const v = formValues(f);
      if (v.evidence !== 'nhan_cong_khoan') { delete v.pit; delete v.pit_exempt; }
      else if (v.pit_exempt) delete v.pit;
      let r;
      if (existing) {
        v.version = existing.version;
        await api('PUT', `/api/costs/${existing.id}`, v);
        toast('Đã lưu');
      } else {
        v.attachments = await readFiles($('#costFiles', f));
        r = await api('POST', '/api/costs', v);
        toast(r.status === 'cho_duyet' ? `Đã lưu ${r.code} — chờ duyệt` : `Đã ghi sổ ${r.code}`);
      }
      closeModal(); await refreshPending(); route(); showWarnings(r);
    });
  });
}

function xmlForm() {
  const body = openModal('Nhập hoá đơn điện tử (file XML)', `<form id="xmlForm"><div class="form-error" hidden></div>
    <p class="muted small">Tải file XML hoá đơn nhà cung cấp gửi (INSOLAR hoặc bên khác). Phần mềm tự đọc số hoá đơn, nhà cung cấp, tiền hàng, thuế và từng dòng hàng; không nhập trùng được.</p>
    <label>File XML hoá đơn</label><input type="file" id="xmlFile" accept=".xml,application/xml,text/xml" required>
    <div id="xmlPreview"></div>
    <div id="xmlFields" hidden>
      <div class="form-grid">
        <div><label>Ngày ghi sổ</label><input type="date" name="date" max="${today()}"></div>
        <div><label>Công trình</label><select name="project_id">${projectOptions('', { includeOverhead: role() !== 'chi_huy' })}</select></div>
        <div><label>Loại chi phí</label><select name="category" id="xmlCat"></select></div>
        <div><label>Thanh toán</label><select name="pay_method">${options(C().PAY_METHODS, 'cong_no')}</select></div>
        <div class="full"><label>Ảnh/PDF kèm theo (không bắt buộc)</label><input type="file" id="xmlExtra" accept="image/*,application/pdf" multiple></div>
      </div>
    </div>
    <div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit" disabled id="xmlSubmit">Ghi chi phí</button></div></form>`);
  const f = $('#xmlForm', body);
  let xml = '', preview = null;
  $('[data-close]', f).addEventListener('click', closeModal);
  const projSel = $('[name=project_id]', f), cat = $('#xmlCat', f);
  const fillCats = () => {
    const isProj = !!projSel.value;
    if (isProj && preview?.is_insolar) { cat.innerHTML = options({ vat_tu_insolar: C().PROJECT_CATEGORIES.vat_tu_insolar }, 'vat_tu_insolar'); return; }
    const map = isProj ? Object.fromEntries(Object.entries(C().PROJECT_CATEGORIES).filter(([k]) => k !== 'vat_tu_insolar')) : C().OVERHEAD_CATEGORIES;
    cat.innerHTML = options(map, isProj ? 'vat_tu_ngoai' : 'chung_khac');
  };
  projSel.addEventListener('change', fillCats);
  $('#xmlFile', f).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    $('#xmlPreview', f).innerHTML = ''; $('#xmlFields', f).hidden = true; $('#xmlSubmit', f).disabled = true;
    if (!file) return;
    xml = await file.text();
    try {
      preview = await api('POST', '/api/costs/einvoice-preview', { xml });
      const i = preview.invoice;
      $('#xmlPreview', f).innerHTML = `<div class="card">
        ${preview.duplicate ? `<div class="notice bad">Hoá đơn này đã nhập ở ${esc(preview.duplicate)}.</div>` : ''}
        ${preview.buyer_ok ? '' : `<div class="notice bad">Hoá đơn xuất cho MST ${esc(i.buyer.mst)}, không phải công ty mình.</div>`}
        ${preview.is_insolar ? '<div class="notice ok">Hoá đơn của INSOLAR → ghi vào "Vật tư lấy của INSOLAR".</div>' : ''}
        <div class="kv"><div>Người bán</div><div><b>${esc(i.seller.name)}</b> · MST ${esc(i.seller.mst)}</div>
        <div>Số hoá đơn</div><div>${esc(i.template)}${esc(i.series)} — số ${esc(i.number)} — ngày ${dmy(i.date)}</div>
        <div>Tiền hàng / thuế / tổng</div><div>${fmt(i.net)} / ${fmt(i.vat)} / <b>${fmt(i.total)}</b></div></div>
        <div class="table-wrap"><table><thead><tr><th>Hàng hoá</th><th>ĐVT</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th><th>Thuế</th></tr></thead><tbody>
        ${i.lines.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="num">${fmt(l.qty)}</td><td class="num">${fmt(l.price)}</td><td class="num">${fmt(l.amount)}</td><td>${esc(l.vat_rate)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
      if (!preview.duplicate && preview.buyer_ok) {
        $('[name=date]', f).value = i.date <= today() ? i.date : today();
        fillCats();
        $('#xmlFields', f).hidden = false; $('#xmlSubmit', f).disabled = false;
      }
    } catch (err) { $('#xmlPreview', f).innerHTML = `<div class="notice bad">${esc(err.message)}</div>`; }
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(f, async () => {
      const v = formValues(f);
      v.xml = xml;
      v.attachments = await readFiles($('#xmlExtra', f));
      const r = await api('POST', '/api/costs/einvoice', v);
      toast(r.status === 'cho_duyet' ? `Đã lưu ${r.code} — chờ duyệt` : `Đã ghi sổ ${r.code}`);
      closeModal(); await refreshPending(); route(); showWarnings(r);
    });
  });
}

function costsTable(items, { showProject = true } = {}) {
  if (!items.length) return '<p class="muted">Chưa có khoản chi nào.</p>';
  const sumNet = items.filter(c => c.status === 'da_duyet').reduce((a, c) => a + c.amount_net, 0);
  const sumVat = items.filter(c => c.status === 'da_duyet').reduce((a, c) => a + c.vat, 0);
  return `<div class="table-wrap"><table><thead><tr><th>Mã</th><th>Ngày</th>${showProject ? '<th>Công trình</th>' : ''}<th>Loại</th><th>Nội dung</th><th>Nhà cung cấp</th><th class="num">Trước thuế</th><th class="num">Thuế</th><th>Trạng thái</th><th>File</th></tr></thead><tbody>
    ${items.map(c => `<tr class="clickable" data-go="#/chi-phi/${c.id}"><td>${esc(c.code)}</td><td>${dmy(c.date)}</td>${showProject ? `<td>${esc(projCode(c.project_id))}</td>` : ''}<td>${esc(C().CATEGORIES[c.category] || c.category)}</td><td>${esc(c.description)}${c.evidence && c.evidence !== 'hoa_don_gtgt' ? `<div class="small muted">${esc((C().EVIDENCE[c.evidence] || '').split(' (')[0].split(' →')[0])}</div>` : ''}</td><td>${esc(partnerName(c.partner_id))}</td><td class="num">${money(c.amount_net)}</td><td class="num">${money(c.vat)}</td><td>${costPill(c)}</td><td>${c.files ? '📎' + c.files : '<span class="neg">—</span>'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="${showProject ? 6 : 5}">Cộng đã ghi sổ</td><td class="num">${fmt(sumNet)}</td><td class="num">${fmt(sumVat)}</td><td colspan="2"></td></tr></tfoot></table></div>`;
}

async function pageCosts(main) {
  const q = new URLSearchParams(sessionStorage.getItem('costFilter') || `month=${thisMonth()}`);
  main.innerHTML = `<div class="page-head"><div><h1>Chi phí</h1><p class="muted">${role() === 'chi_huy' ? 'Các khoản bạn đã nhập.' : 'Mọi khoản chi, kể cả chờ duyệt và đã từ chối.'}</p></div>
    <div class="actions">${can('quan_tri', 'ke_toan', 'chi_huy') ? '<button class="btn primary" id="btnAddCost">+ Nhập chi phí</button><button class="btn" id="btnXml">Nhập hoá đơn XML</button>' : ''}<button class="btn" id="btnCsv">Xuất Excel (CSV)</button></div></div>
    <div class="filters"><input type="month" id="fMonth" value="${esc(q.get('month') || '')}">
      <select id="fProject"><option value="">Tất cả công trình</option><option value="chung" ${q.get('project_id') === 'chung' ? 'selected' : ''}>Chỉ chi phí chung</option>${S.boot.projects.map(p => `<option value="${p.id}" ${String(p.id) === q.get('project_id') ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}</option>`).join('')}</select>
      <select id="fStatus"><option value="">Mọi trạng thái</option>${options(C().COST_STATUS, q.get('status'))}</select></div>
    <div class="card" id="costList"><div class="loading">Đang tải…</div></div>`;
  bindCommon(main);
  let items = [];
  const load = async () => {
    const p = new URLSearchParams();
    if ($('#fMonth').value) p.set('month', $('#fMonth').value);
    if ($('#fProject').value) p.set('project_id', $('#fProject').value);
    if ($('#fStatus').value) p.set('status', $('#fStatus').value);
    sessionStorage.setItem('costFilter', p.toString());
    items = (await api('GET', '/api/costs?' + p)).items;
    $('#costList').innerHTML = costsTable(items);
    bindCommon($('#costList'));
  };
  ['#fMonth', '#fProject', '#fStatus'].forEach(s => $(s).addEventListener('change', load));
  $('#btnCsv').addEventListener('click', () => csvDownload(`chi-phi-${$('#fMonth').value || 'tat-ca'}.csv`, [
    ['Mã', 'Ngày', 'Công trình', 'Loại', 'Nội dung', 'Nhà cung cấp', 'MST NCC', 'Trước thuế', 'Thuế GTGT', 'Tổng', 'Thanh toán', 'Số HĐ', 'Trạng thái', 'Người lập', 'Người duyệt', 'Loại chứng từ', 'TNCN khấu trừ'],
    ...items.map(c => [c.code, c.date, projCode(c.project_id), C().CATEGORIES[c.category], c.description, partnerName(c.partner_id), S.boot.partners.find(p => p.id === c.partner_id)?.mst || '',
      c.amount_net, c.vat, c.amount_net + c.vat, C().PAY_METHODS[c.pay_method], c.invoice_no, c.reverses_id ? 'Bút toán đảo' : c.reversed_by_id ? 'Đã huỷ' : C().COST_STATUS[c.status], userName(c.created_by), userName(c.approved_by), C().EVIDENCE[c.evidence] || '', c.pit || 0]),
  ]));
  await load();
}

async function pageCostDetail(main, id) {
  const d = await api('GET', `/api/costs/${id}`);
  const c = d.cost;
  const isPending = c.status === 'cho_duyet';
  const canApprove = isPending && can('quan_tri', 'ke_toan', 'co_dong') && c.created_by !== me().id;
  const canEdit = isPending && (c.created_by === me().id || can('quan_tri', 'ke_toan'));
  const canReject = isPending && (can('quan_tri', 'ke_toan', 'co_dong') || c.created_by === me().id);
  const canVoid = c.status === 'da_duyet' && !c.reverses_id && !c.reversed_by_id && can('quan_tri', 'ke_toan');
  const actLabel = { tao: 'Tạo', sua: 'Sửa', duyet: 'Duyệt', tu_choi: 'Từ chối', huy: 'Huỷ (bút toán đảo)', nhap_hddt: 'Nhập từ hoá đơn điện tử', bo_sung_chung_tu: 'Bổ sung chứng từ' };
  main.innerHTML = `<div class="page-head"><div><a href="#/chi-phi" class="small">← Chi phí</a><h1>${esc(c.code)} ${costPill(c)}</h1></div>
    <div class="actions">${canApprove ? '<button class="btn ok" id="aApprove">✓ Duyệt</button>' : ''}${canReject ? '<button class="btn danger" id="aReject">Từ chối</button>' : ''}${canEdit ? '<button class="btn" id="aEdit">Sửa</button>' : ''}${canVoid ? '<button class="btn danger" id="aVoid">Huỷ (lập bút toán đảo)</button>' : ''}<button class="btn" id="aAddFile">+ Bổ sung chứng từ</button></div></div>
    <div class="card"><div class="kv">
      <div>Ngày chứng từ</div><div>${dmy(c.date)}</div>
      <div>Công trình</div><div>${c.project_id ? `<a href="#/cong-trinh/${c.project_id}">${esc(projName(c.project_id))}</a>` : 'Chi phí chung (TK 6422)'}</div>
      <div>Loại</div><div>${esc(C().CATEGORIES[c.category])}</div>
      <div>Nội dung</div><div>${esc(c.description)}</div>
      <div>Nhà cung cấp</div><div>${esc(partnerName(c.partner_id)) || '—'}</div>
      <div>Tiền trước thuế</div><div>${money(c.amount_net)} đ</div>
      <div>Thuế GTGT</div><div>${money(c.vat)} đ</div>
      <div>Loại chứng từ</div><div>${esc(C().EVIDENCE[c.evidence] || '')}</div>
      ${c.pit ? `<div>Khấu trừ thuế TNCN</div><div>${money(c.pit)} đ (thực trả ${fmt(c.amount_net + c.vat - c.pit)} đ)</div>` : ''}
      <div>Tổng chi phí</div><div><b>${money(c.amount_net + c.vat)} đ</b> — ${esc(C().PAY_METHODS[c.pay_method])}${c.pay_method === 'tam_ung' ? ' của ' + esc(userName(c.advance_user_id)) : ''}</div>
      ${c.evidence === 'khong_hop_le' ? '<div>Thuế</div><div><span class="pill bad">Không được trừ khi tính thuế TNDN</span></div>' : ''}
      ${c.vat && c.pay_method === 'tien_mat' && (c.amount_net + c.vat) >= Number(S.boot.settings.cash_limit) ? '<div>Thuế</div><div><span class="pill bad">Trả tiền mặt ≥ ngưỡng: thuế GTGT đầu vào không được khấu trừ</span></div>' : ''}
      <div>Số hoá đơn</div><div>${esc(c.invoice_no) || '—'} ${c.invoice_date ? '· ' + dmy(c.invoice_date) : ''} ${c.source === 'hddt' ? '<span class="pill ok">Từ hoá đơn điện tử</span>' : ''}</div>
      <div>Người lập</div><div>${esc(userName(c.created_by))} · ${esc(c.created_at)}</div>
      <div>Người duyệt</div><div>${c.approved_by ? `${esc(userName(c.approved_by))} · ${esc(c.approved_at)}` : '—'}</div>
      ${c.reason ? `<div>Lý do</div><div>${esc(c.reason)}</div>` : ''}
      ${c.reverses_id ? `<div>Đảo cho</div><div><a href="#/chi-phi/${c.reverses_id}">Xem chứng từ gốc</a></div>` : ''}
      ${c.reversed_by_id ? `<div>Đã huỷ bởi</div><div><a href="#/chi-phi/${c.reversed_by_id}">Xem bút toán đảo</a></div>` : ''}
    </div></div>
    <div class="card"><h2>Chứng từ đính kèm</h2><div class="files">${d.files.map(f => `<a href="/api/attachments/${f.id}" target="_blank" rel="noopener">📎 ${esc(f.name)} <span class="muted">(${Math.round(f.size / 1024)} KB)</span></a>`).join('') || '<span class="neg">Chưa có chứng từ</span>'}</div></div>
    ${d.lines.length ? `<div class="card"><h2>Chi tiết hàng hoá trên hoá đơn</h2><div class="table-wrap"><table><thead><tr><th>Hàng hoá</th><th>ĐVT</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th><th>Thuế</th></tr></thead><tbody>
      ${d.lines.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="num">${fmt(l.qty)}</td><td class="num">${fmt(l.price)}</td><td class="num">${fmt(l.amount)}</td><td>${esc(l.vat_rate)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="card"><h2>Lịch sử</h2><ul>${d.history.map(h => `<li>${esc(h.at)} — <b>${esc(userName(h.user_id))}</b>: ${esc(actLabel[h.action] || h.action)}</li>`).join('')}</ul></div>`;
  const act = (btn, fn) => once(btn, async () => { await fn(); await refreshPending(); route(); });
  $('#aApprove')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/costs/${id}/approve`, { version: c.version }); toast('Đã duyệt'); }));
  $('#aReject')?.addEventListener('click', (e) => { const reason = prompt('Lý do từ chối:'); if (reason) act(e.currentTarget, async () => { await api('POST', `/api/costs/${id}/reject`, { reason, version: c.version }); toast('Đã từ chối'); }); });
  $('#aVoid')?.addEventListener('click', (e) => { const reason = prompt('Lý do huỷ (sẽ lập bút toán đảo, không xoá chứng từ gốc):'); if (reason) act(e.currentTarget, async () => { const r = await api('POST', `/api/costs/${id}/void`, { reason }); toast(`Đã lập bút toán đảo ${r.code}`); }); });
  $('#aEdit')?.addEventListener('click', () => costForm(c));
  $('#aAddFile').addEventListener('click', () => attachForm('costs', c.id));
}

function attachForm(ownerType, ownerId) {
  const body = openModal('Bổ sung chứng từ', `<form id="attForm"><div class="form-error" hidden></div>
    <label>Ảnh / PDF</label><input type="file" id="attFiles" accept="image/*,application/pdf" multiple required>
    <div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">Tải lên</button></div></form>`);
  const f = $('#attForm', body);
  $('[data-close]', f).addEventListener('click', closeModal);
  f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => {
    await api('POST', '/api/attachments', { owner_type: ownerType, owner_id: ownerId, attachments: await readFiles($('#attFiles', f)) });
    toast('Đã tải lên'); closeModal(); route();
  }); });
}

async function pageApprovals(main) {
  const items = (await api('GET', '/api/costs?status=cho_duyet&limit=500')).items;
  main.innerHTML = `<div class="page-head"><div><h1>Chờ duyệt</h1><p class="muted">Khoản do chỉ huy nhập hoặc lớn hơn ngưỡng ${fmt(S.boot.settings.approval_threshold)} đ. Người lập không được tự duyệt. Bấm vào từng dòng để xem chứng từ trước khi duyệt.</p></div></div>
    <div class="card">${costsTable(items)}</div>`;
  bindCommon(main);
}

// ---------- Công trình ----------
function projectForm(p) {
  const x = p || { start_date: today(), vat_rate: 8, status: 'dang_thi_cong' };
  const editableStatus = Object.fromEntries(Object.entries(C().PROJECT_STATUS).filter(([k]) => k !== 'da_nghiem_thu'));
  const body = openModal(p ? `Sửa ${p.code}` : 'Thêm công trình', `<form id="pjForm"><div class="form-error" hidden></div><div class="form-grid">
    ${p ? '' : '<div><label>Mã công trình</label><input name="code" placeholder="Bỏ trống để tự sinh (CT-YYMM-NN)"></div>'}
    <div class="${p ? 'full' : ''}"><label>Tên công trình</label><input name="name" value="${esc(x.name || '')}" required></div>
    <div><label>Khách hàng (chủ đầu tư)</label><select name="customer_id">${partnerOptions(x.customer_id, '— Chọn —')}</select></div>
    <div><label>Địa chỉ công trình</label><input name="address" value="${esc(x.address || '')}"></div>
    <div><label>Giá trị hợp đồng (trước thuế)</label><input name="contract_value" data-money inputmode="numeric" value="${x.contract_value ? fmt(x.contract_value) : ''}"></div>
    <div><label>Thuế suất GTGT</label><select name="vat_rate">${options({ 0: '0%', 5: '5%', 8: '8%', 10: '10%' }, x.vat_rate)}</select></div>
    <div><label>Ngày khởi công</label><input type="date" name="start_date" value="${esc(x.start_date)}"></div>
    <div><label>Chỉ huy phụ trách</label><select name="manager_user_id"><option value="">— Chọn —</option>${S.boot.users.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === x.manager_user_id ? 'selected' : ''}>${esc(u.full_name)}</option>`).join('')}</select></div>
    ${p && p.status !== 'da_nghiem_thu' ? `<div><label>Trạng thái</label><select name="status">${options(editableStatus, x.status)}</select></div>` : ''}
    <div class="full"><label>Ghi chú</label><textarea name="note" rows="2">${esc(x.note || '')}</textarea></div>
  </div><div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">Lưu</button></div></form>`);
  const f = $('#pjForm', body);
  $('[data-close]', f).addEventListener('click', closeModal);
  f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => {
    const v = formValues(f);
    if (p) await api('PUT', `/api/projects/${p.id}`, { ...v, version: p.version }); else await api('POST', '/api/projects', v);
    await loadBoot(); closeModal(); toast('Đã lưu'); route();
  }); });
}

async function pageProjects(main) {
  const items = (await api('GET', '/api/report/projects')).items;
  const sum = (k) => items.filter(p => p.status !== 'huy').reduce((a, p) => a + p[k], 0);
  main.innerHTML = `<div class="page-head"><div><h1>Công trình</h1><p class="muted">Lũy kế từ đầu đến nay, chỉ tính số đã ghi sổ.</p></div>
    <div class="actions">${can('quan_tri', 'ke_toan') ? '<button class="btn primary" id="btnAddPj">+ Thêm công trình</button>' : ''}<button class="btn" id="btnCsv">Xuất Excel (CSV)</button></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Tên</th><th>Trạng thái</th><th class="num">Giá trị HĐ</th><th class="num">Doanh thu</th><th class="num">Chi phí</th><th class="num">Lãi gộp</th><th class="num">% lãi</th><th class="num">Còn phải thu</th></tr></thead><tbody>
    ${items.map(p => `<tr class="clickable" data-go="#/cong-trinh/${p.id}"><td>${esc(p.code)}</td><td>${esc(p.name)}${p.over_budget.length ? ' <span class="pill bad">Vượt dự toán</span>' : ''}</td><td>${projectPill(p.status)}</td><td class="num">${fmt(p.contract_value)}</td><td class="num">${fmt(p.revenue)}</td><td class="num">${fmt(p.cost)}${p.budget_total ? `<div class="small muted">${pctTxt(p.budget_used_pct)} dự toán</div>` : ''}</td><td class="num">${money(p.gross)}</td><td class="num">${p.revenue ? pctTxt(p.gross_pct) : '—'}</td><td class="num">${fmt(p.receivable)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Chưa có công trình.</td></tr>'}
    </tbody><tfoot><tr><td colspan="3">Cộng (trừ công trình huỷ)</td><td class="num">${fmt(sum('contract_value'))}</td><td class="num">${fmt(sum('revenue'))}</td><td class="num">${fmt(sum('cost'))}</td><td class="num">${fmt(sum('gross'))}</td><td></td><td class="num">${fmt(sum('receivable'))}</td></tr></tfoot></table></div></div>`;
  bindCommon(main);
  $('#btnAddPj')?.addEventListener('click', () => projectForm());
  $('#btnCsv').addEventListener('click', () => csvDownload('cong-trinh.csv', [
    ['Mã', 'Tên', 'Trạng thái', 'Ngày nghiệm thu', 'Giá trị HĐ', 'Doanh thu', ...Object.values(C().PROJECT_CATEGORIES), 'Tổng chi phí', 'Lãi gộp', '% lãi', 'Đã xuất HĐ (gồm thuế)', 'Đã thu', 'Còn phải thu'],
    ...items.map(p => [p.code, p.name, C().PROJECT_STATUS[p.status], p.accepted_date, p.contract_value, p.revenue, ...Object.keys(C().PROJECT_CATEGORIES).map(k => p.costs[k] || 0), p.cost, p.gross, p.gross_pct, p.billed, p.received, p.receivable]),
  ]));
}

async function pageProjectDetail(main, id) {
  id = Number(id);
  const p = S.boot.projects.find(x => x.id === id);
  if (!p) throw new Error('Không tìm thấy công trình');
  const [sum, costs, revs, recs] = await Promise.all([
    api('GET', '/api/report/projects'), api('GET', `/api/costs?project_id=${id}&limit=2000`),
    api('GET', `/api/revenues?project_id=${id}`), api('GET', `/api/receipts?project_id=${id}`),
  ]);
  const s = sum.items.find(x => x.id === id);
  main.innerHTML = `<div class="page-head"><div><a href="#/cong-trinh" class="small">← Công trình</a><h1>${esc(p.code)} · ${esc(p.name)} ${projectPill(p.status)}</h1>
    <p class="muted">${esc(p.address)} ${p.customer_id ? '· Khách: ' + esc(partnerName(p.customer_id)) : ''} · Khởi công ${dmy(p.start_date)} ${p.accepted_date ? '· Nghiệm thu ' + dmy(p.accepted_date) : ''}</p></div>
    <div class="actions">${can('quan_tri', 'ke_toan') ? `<button class="btn" id="pEdit">Sửa</button>${p.status !== 'da_nghiem_thu' && p.status !== 'huy' ? '<button class="btn ok" id="pAccept">Nghiệm thu</button>' : ''}` : ''}${can('quan_tri') && p.status === 'da_nghiem_thu' ? '<button class="btn danger" id="pReopen">Mở lại</button>' : ''}</div></div>
    <div class="kpis">
      <div class="kpi"><div class="l">Giá trị hợp đồng</div><div class="v">${fmt(s.contract_value)}</div></div>
      <div class="kpi"><div class="l">Doanh thu đã ghi</div><div class="v">${fmt(s.revenue)}</div></div>
      <div class="kpi"><div class="l">Chi phí đã ghi</div><div class="v">${fmt(s.cost)}</div><div class="l">${s.contract_value ? pctTxt(s.cost_vs_contract_pct) + ' giá trị HĐ' : ''}</div></div>
      <div class="kpi"><div class="l">Lãi gộp</div><div class="v ${s.gross < 0 ? 'neg' : ''}">${fmt(s.gross)}</div><div class="l">${s.revenue ? pctTxt(s.gross_pct) + ' doanh thu' : ''}</div></div>
      <div class="kpi"><div class="l">Còn phải thu khách</div><div class="v">${fmt(s.receivable)}</div></div>
    </div>
    <div class="card"><div class="page-head"><h2>Bóc tách chi phí & dự toán</h2>${can('quan_tri', 'ke_toan') ? '<button class="btn sm" id="pBudget">Lập / sửa dự toán</button>' : ''}</div>
      ${s.over_budget.length ? `<div class="notice bad">Vượt dự toán: ${s.over_budget.map(k => esc(C().PROJECT_CATEGORIES[k])).join(', ')}</div>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Khoản mục</th><th class="num">Thực tế</th><th class="num">% tổng CP</th><th class="num">Dự toán</th><th class="num">% dùng</th><th class="num">Còn lại</th></tr></thead><tbody>
      ${Object.entries(C().PROJECT_CATEGORIES).map(([k, l]) => { const a = s.costs[k] || 0, b = s.budget[k] || 0; return `<tr><td>${esc(l)}</td><td class="num">${fmt(a)}</td><td class="num muted">${s.cost ? pctTxt(Math.round(a * 10000 / s.cost) / 100) : ''}</td><td class="num">${b ? fmt(b) : '—'}</td><td class="num ${b && a > b ? 'neg' : ''}">${b ? pctTxt(Math.round(a * 10000 / b) / 100) : ''}</td><td class="num">${b ? money(b - a) : ''}</td></tr>`; }).join('')}
    </tbody><tfoot><tr><td>Tổng</td><td class="num">${fmt(s.cost)}</td><td></td><td class="num">${s.budget_total ? fmt(s.budget_total) : '—'}</td><td class="num">${s.budget_total ? pctTxt(s.budget_used_pct) : ''}</td><td class="num">${s.budget_total ? money(s.budget_total - s.cost) : ''}</td></tr></tfoot></table></div>
      ${s.planned_gross != null ? `<p class="small muted">Lãi gộp dự kiến theo dự toán: <b>${fmt(s.planned_gross)}</b> đ${s.contract_value ? ` (${pctTxt(Math.round(s.planned_gross * 10000 / s.contract_value) / 100)} giá trị HĐ)` : ''}.</p>` : ''}</div>
    <div class="card"><h2>Chi phí</h2>${costsTable(costs.items, { showProject: false })}</div>
    <div class="card"><h2>Doanh thu (hoá đơn xuất cho khách)</h2>${ledgerTable('revenues', revs.items)}</div>
    <div class="card"><h2>Tiền khách đã trả</h2>${ledgerTable('receipts', recs.items)}</div>`;
  bindCommon(main);
  bindLedger(main);
  $('#pEdit')?.addEventListener('click', () => projectForm(p));
  $('#pBudget')?.addEventListener('click', () => budgetForm(p, s));
  $('#pAccept')?.addEventListener('click', () => {
    const body = openModal('Nghiệm thu công trình', `<form id="accForm"><div class="form-error" hidden></div>
      <p>Khi nghiệm thu, toàn bộ chi phí dở dang (TK 154) của công trình được kết chuyển sang giá vốn (TK 632) và lãi/lỗ công trình được tính vào tháng nghiệm thu.</p>
      <label>Ngày nghiệm thu</label><input type="date" name="date" value="${today()}" max="${today()}" required>
      <div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">Xác nhận nghiệm thu</button></div></form>`);
    const f = $('#accForm', body);
    $('[data-close]', f).addEventListener('click', closeModal);
    f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => { await api('POST', `/api/projects/${id}/accept`, { ...formValues(f), version: p.version }); await loadBoot(); closeModal(); toast('Đã nghiệm thu'); route(); }); });
  });
  $('#pReopen')?.addEventListener('click', (ev) => {
    const reason = prompt('Lý do mở lại (huỷ trạng thái nghiệm thu):');
    if (!reason) return;
    once(ev.currentTarget, async () => { await api('POST', `/api/projects/${id}/reopen`, { reason }); await loadBoot(); route(); });
  });
}

// ---------- Doanh thu, thu tiền, trả NCC ----------
function ledgerTable(t, items) {
  if (!items.length) return '<p class="muted">Chưa có.</p>';
  const isRev = t === 'revenues', isPay = t === 'payments';
  const voidBtn = (x) => (can('quan_tri', 'ke_toan') && !x.reverses_id && !x.reversed_by_id ? `<button class="btn sm danger" data-void="${t}:${x.id}">Huỷ</button>` : '');
  const st = (x) => (x.reverses_id ? '<span class="pill gray">Bút toán đảo</span>' : x.reversed_by_id ? '<span class="pill gray">Đã huỷ</span>' : '');
  const total = items.reduce((a, x) => a + (isRev ? x.amount_net : x.amount), 0);
  return `<div class="table-wrap"><table><thead><tr><th>Mã</th><th>Ngày</th><th>${isPay ? 'Nhà cung cấp' : 'Công trình'}</th><th>Nội dung</th>${isRev ? '<th>Số HĐ</th><th class="num">Trước thuế</th><th class="num">Thuế</th>' : '<th>Hình thức</th><th class="num">Số tiền</th>'}<th></th><th>File</th><th></th></tr></thead><tbody>
    ${items.map(x => `<tr><td>${esc(x.code)}</td><td>${dmy(x.date)}</td><td>${esc(isPay ? partnerName(x.partner_id) : projCode(x.project_id))}</td><td>${esc(x.description)}</td>
      ${isRev ? `<td>${esc(x.invoice_no)}</td><td class="num">${money(x.amount_net)}</td><td class="num">${money(x.vat)}</td>` : `<td>${esc(C().CASH_METHODS[x.method])}</td><td class="num">${money(x.amount)}</td>`}
      <td>${st(x)}</td><td>${x.files ? `<a href="#" data-files="${t}:${x.id}">📎${x.files}</a>` : '—'}</td><td>${voidBtn(x)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="${isRev ? 5 : 5}">Cộng</td><td class="num">${fmt(total)}</td>${isRev ? `<td class="num">${fmt(items.reduce((a, x) => a + x.vat, 0))}</td>` : ''}<td colspan="3"></td></tr></tfoot></table></div>`;
}
function bindLedger(root) {
  $$('[data-void]', root).forEach(b => b.addEventListener('click', async () => {
    const [t, id] = b.dataset.void.split(':');
    const reason = prompt('Lý do huỷ (lập bút toán đảo, không xoá chứng từ gốc):');
    if (!reason) return;
    once(b, async () => { const r = await api('POST', `/api/${t}/${id}/void`, { reason }); toast(`Đã lập bút toán đảo ${r.code}`); route(); });
  }));
  $$('[data-files]', root).forEach(a => a.addEventListener('click', async (e) => {
    e.preventDefault();
    const [t, id] = a.dataset.files.split(':');
    const r = await api('GET', `/api/attachments?owner_type=${t}&owner_id=${id}`);
    openModal('Chứng từ đính kèm', `<div class="files">${r.items.map(f => `<a href="/api/attachments/${f.id}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>`).join('')}</div>`);
  }));
}
function ledgerForm(t) {
  const isRev = t === 'revenues', isPay = t === 'payments';
  const title = isRev ? 'Ghi doanh thu (hoá đơn xuất cho khách)' : isPay ? 'Trả tiền nhà cung cấp' : 'Ghi tiền khách trả';
  const body = openModal(title, `<form id="lgForm"><div class="form-error" hidden></div><div class="form-grid">
    <div><label>Ngày</label><input type="date" name="date" value="${today()}" max="${today()}" required></div>
    ${isPay ? `<div><label>Nhà cung cấp</label><select name="partner_id" required>${partnerOptions('')}</select></div>` : `<div><label>Công trình</label><select name="project_id" required>${projectOptions('', { includeOverhead: false })}</select></div>`}
    ${isRev ? `<div><label>Doanh thu trước thuế</label><input name="amount_net" data-money inputmode="numeric" required></div>
      <div><label>Thuế GTGT</label><div class="actions"><select id="lgRate"><option value="">Tự nhập</option><option value="0">0%</option><option value="5">5%</option><option value="8" selected>8%</option><option value="10">10%</option></select><input name="vat" data-money inputmode="numeric" value="0"></div></div>
      <div><label>Số hoá đơn</label><input name="invoice_no"></div>`
      : `<div><label>Số tiền</label><input name="amount" data-money inputmode="numeric" required></div><div><label>Hình thức</label><select name="method">${options(C().CASH_METHODS, 'chuyen_khoan')}</select></div>`}
    <div class="full"><label>Nội dung</label><input name="description" ${isRev ? 'required' : ''} placeholder="${isRev ? 'vd: Nghiệm thu đợt 1' : ''}"></div>
    <div class="full"><label>Chứng từ ${isRev || isPay ? '(bắt buộc: hoá đơn / uỷ nhiệm chi / phiếu chi)' : '(không bắt buộc)'}</label><input type="file" id="lgFiles" accept="image/*,application/pdf,.xml" multiple ${isRev || isPay ? 'required' : ''}></div>
  </div><div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">Lưu</button></div></form>`);
  const f = $('#lgForm', body);
  $('[data-close]', f).addEventListener('click', closeModal);
  if (isRev) {
    const net = $('[name=amount_net]', f), vat = $('[name=vat]', f), rate = $('#lgRate', f);
    const rc = () => { if (rate.value !== '') vat.value = fmt(Math.round(parseMoney(net.value) * Number(rate.value) / 100)); };
    net.addEventListener('input', rc); rate.addEventListener('change', rc); vat.addEventListener('input', () => { rate.value = ''; });
  }
  f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => {
    const v = formValues(f);
    v.attachments = await readFiles($('#lgFiles', f));
    const r = await api('POST', `/api/${t}`, v);
    toast(`Đã ghi ${r.code}`); closeModal(); route();
  }); });
}

async function pageRevenues(main) {
  const m = sessionStorage.getItem('revMonth') ?? thisMonth();
  main.innerHTML = `<div class="page-head"><div><h1>Doanh thu & thu tiền</h1><p class="muted">Doanh thu = hoá đơn đã xuất cho khách (ghi Nợ 131 / Có 511, 33311). Thu tiền ghi giảm công nợ khách.</p></div>
    <div class="actions">${can('quan_tri', 'ke_toan') ? '<button class="btn primary" id="addRev">+ Ghi doanh thu</button><button class="btn" id="addRec">+ Ghi tiền khách trả</button>' : ''}</div></div>
    <div class="filters">${monthInput('fMonth', m)}<span class="muted small">Bỏ trống tháng để xem tất cả</span></div>
    <div class="card"><h2>Doanh thu</h2><div id="revBox" class="loading">Đang tải…</div></div>
    <div class="card"><h2>Tiền khách đã trả</h2><div id="recBox" class="loading">Đang tải…</div></div>`;
  const load = async () => {
    const mm = $('#fMonth').value; sessionStorage.setItem('revMonth', mm);
    const q = mm ? `?month=${mm}` : '';
    const [a, b] = await Promise.all([api('GET', '/api/revenues' + q), api('GET', '/api/receipts' + q)]);
    $('#revBox').className = ''; $('#recBox').className = '';
    $('#revBox').innerHTML = ledgerTable('revenues', a.items); $('#recBox').innerHTML = ledgerTable('receipts', b.items);
    bindLedger(main);
  };
  $('#fMonth').addEventListener('change', load);
  $('#addRev')?.addEventListener('click', () => ledgerForm('revenues'));
  $('#addRec')?.addEventListener('click', () => ledgerForm('receipts'));
  await load();
}

async function pageBalances(main) {
  const [b, pays] = await Promise.all([api('GET', '/api/report/balances'), api('GET', '/api/payments')]);
  const ins = b.suppliers.find(s => s.is_insolar);
  main.innerHTML = `<div class="page-head"><div><h1>Công nợ & trả nhà cung cấp</h1><p class="muted">Phải trả = chi phí ghi "công nợ" (gồm thuế) − đã trả. Phải thu = hoá đơn đã xuất (gồm thuế) − khách đã trả.</p></div>
    <div class="actions">${can('quan_tri', 'ke_toan') ? '<button class="btn primary" id="addPay">+ Trả tiền nhà cung cấp</button>' : ''}<button class="btn" id="csvIns">Xuất đối chiếu INSOLAR (CSV)</button></div></div>
    <div class="card"><h2>Đối chiếu với INSOLAR (${esc(S.boot.settings.insolar_mst)})</h2>
      <p class="muted small">Hai công ty không nối hệ thống. Mỗi tháng so bảng này với số INSOLAR báo; lệch thì kiểm tra hoá đơn chưa nhập hoặc tiền chưa ghi.</p>
      ${b.insolar.length ? `<div class="table-wrap"><table><thead><tr><th>Tháng</th><th class="num">Số hoá đơn</th><th class="num">Tiền mua (gồm thuế)</th><th class="num">Trong đó ghi nợ</th><th class="num">Đã trả</th><th class="num">Còn nợ cuối tháng</th></tr></thead><tbody>
      ${b.insolar.map(r => `<tr><td>${my(r.month)}</td><td class="num">${r.invoices}</td><td class="num">${fmt(r.purchased)}</td><td class="num">${fmt(r.on_credit)}</td><td class="num">${fmt(r.paid)}</td><td class="num"><b>${fmt(r.balance_end)}</b></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Chưa có giao dịch với INSOLAR.</p>'}
      ${ins ? `<p>Hiện còn nợ INSOLAR: <b>${fmt(ins.balance)} đ</b></p>` : ''}</div>
    <div class="card"><h2>Phải trả nhà cung cấp</h2><div class="table-wrap"><table><thead><tr><th>Nhà cung cấp</th><th>MST</th><th class="num">Tổng mua</th><th class="num">Ghi nợ</th><th class="num">Đã trả</th><th class="num">Còn nợ</th></tr></thead><tbody>
      ${b.suppliers.map(s => `<tr><td>${esc(s.name)} ${s.is_insolar ? '<span class="pill ok">INSOLAR</span>' : ''}</td><td>${esc(s.mst)}</td><td class="num">${fmt(s.purchased)}</td><td class="num">${fmt(s.on_credit)}</td><td class="num">${fmt(s.paid)}</td><td class="num"><b>${money(s.balance)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có.</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><h2>Phải thu khách theo công trình</h2><div class="table-wrap"><table><thead><tr><th>Công trình</th><th class="num">Đã xuất HĐ (gồm thuế)</th><th class="num">Đã thu</th><th class="num">Còn phải thu</th></tr></thead><tbody>
      ${b.projects.filter(p => p.billed || p.received).map(p => `<tr><td>${esc(p.code)} · ${esc(p.name)}</td><td class="num">${fmt(p.billed)}</td><td class="num">${fmt(p.received)}</td><td class="num"><b>${money(p.receivable)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Chưa có.</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><h2>Các lần trả tiền nhà cung cấp</h2>${ledgerTable('payments', pays.items)}</div>`;
  bindLedger(main);
  $('#addPay')?.addEventListener('click', () => ledgerForm('payments'));
  $('#csvIns').addEventListener('click', () => csvDownload('doi-chieu-insolar.csv', [
    ['Tháng', 'Số hoá đơn', 'Tiền mua (gồm thuế)', 'Trong đó ghi nợ', 'Đã trả', 'Còn nợ cuối tháng'],
    ...b.insolar.map(r => [r.month, r.invoices, r.purchased, r.on_credit, r.paid, r.balance_end]),
  ]));
}

// ---------- Báo cáo tháng ----------
function reportProjectsTable(r, full = true) {
  if (!r.projects.length) return '<p class="muted">Không có công trình phát sinh.</p>';
  const cats = Object.entries(C().PROJECT_CATEGORIES);
  const kind = { nghiem_thu: '<span class="pill ok">Nghiệm thu trong tháng</span>', sau_nghiem_thu: '<span class="pill gray">Phát sinh sau nghiệm thu</span>', do_dang: '<span class="pill warn">Đang thi công</span>' };
  return `<div class="table-wrap"><table><thead><tr><th>Công trình</th><th></th><th class="num">DT tháng</th><th class="num">CP tháng</th>${full ? cats.map(([, l]) => `<th class="num">${esc(l)} (lũy kế)</th>`).join('') : ''}<th class="num">DT lũy kế</th><th class="num">CP lũy kế</th><th class="num">Lãi gộp lũy kế</th><th class="num">%</th>${full ? '<th class="num">Phân bổ CP chung + BH</th><th class="num">Lãi ròng</th>' : ''}</tr></thead><tbody>
    ${r.projects.map(p => `<tr><td><a href="#/cong-trinh/${p.id}">${esc(p.code)}</a> · ${esc(p.name)}</td><td>${kind[p.kind]}</td><td class="num">${fmt(p.month.revenue)}</td><td class="num">${fmt(p.month.cost_total)}</td>
      ${full ? cats.map(([k]) => `<td class="num">${fmt(p.to_date.costs[k] || 0)}</td>`).join('') : ''}
      <td class="num">${fmt(p.to_date.revenue)}</td><td class="num">${fmt(p.to_date.cost_total)}</td><td class="num">${money(p.to_date.gross)}</td><td class="num">${p.to_date.revenue ? pctTxt(p.to_date.gross_pct) : '—'}</td>
      ${full ? `<td class="num">${p.allocated != null ? fmt(p.allocated) : ''}</td><td class="num">${p.net != null ? money(p.net) + ` <span class="muted small">(${pctTxt(p.net_pct)})</span>` : ''}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}

async function pageReport(main) {
  const m = sessionStorage.getItem('repMonth') || prevMonth(thisMonth());
  main.innerHTML = `<div class="page-head"><div><h1>Báo cáo tháng</h1><p class="muted">Lãi/lỗ công trình được tính vào tháng nghiệm thu. Công trình đang thi công chỉ cộng dồn chi phí dở dang.</p></div>
    <div class="actions" id="repActions"></div></div>
    <div class="filters">${monthInput('fMonth', m)}</div><div id="repBox" class="loading">Đang tải…</div>`;
  const load = async () => {
    const mm = $('#fMonth').value || prevMonth(thisMonth());
    sessionStorage.setItem('repMonth', mm);
    const d = await api('GET', `/api/report/month?m=${mm}`);
    const r = d.report;
    const s = S.boot.settings;
    const canLock = can('quan_tri', 'ke_toan') && !d.locked && mm < thisMonth();
    const signed = d.signoffs.some(x => x.user_id === me().id);
    const canSign = can('quan_tri', 'co_dong') && d.locked && !signed;
    $('#repActions').innerHTML = `${canLock ? '<button class="btn primary" id="btnLock">Khoá sổ tháng này</button>' : ''}${canSign ? '<button class="btn ok" id="btnSign">Ký xác nhận số liệu</button>' : ''}<button class="btn" id="btnPrint">In / PDF</button><button class="btn" id="btnCsv">Xuất Excel (CSV)</button>`;
    const ohRows = Object.entries(C().OVERHEAD_CATEGORIES).map(([k, l]) => `<tr><td>${esc(l)}</td><td class="num">${fmt(r.overhead[k] || 0)}</td></tr>`).join('');
    $('#repBox').className = '';
    $('#repBox').innerHTML = `
      <div class="print-only"><h2>${esc(s.company_name)}</h2><p>MST: ${esc(s.company_mst)} · ${esc(s.company_address)}</p><h1>BÁO CÁO KẾT QUẢ THÁNG ${my(mm)}</h1></div>
      ${d.locked ? `<div class="notice ${d.integrity ? 'ok' : 'bad'}">Tháng đã khoá sổ lúc ${esc(d.lock.locked_at)}. ${d.integrity ? 'Kiểm tra: số liệu gốc khớp với lúc khoá.' : 'CẢNH BÁO: số liệu gốc hiện tại KHÁC lúc khoá — cần kiểm tra nhật ký thao tác.'} <span class="small">Mã số liệu: ${esc(d.lock.hash.slice(0, 16))}</span></div>` : `<div class="notice">Tháng chưa khoá sổ — số liệu còn có thể thay đổi.${d.pending ? ` Còn ${d.pending} khoản chi chờ duyệt.` : ''}</div>`}
      <div class="kpis">
        <div class="kpi"><div class="l">Lãi gộp công trình nghiệm thu</div><div class="v">${fmt(r.completed_gross)}</div></div>
        <div class="kpi"><div class="l">Điều chỉnh sau nghiệm thu</div><div class="v">${fmt(r.adjustments)}</div></div>
        <div class="kpi"><div class="l">Chi phí chung</div><div class="v">${fmt(r.overhead_total)}</div></div>
        <div class="kpi"><div class="l">Dự phòng bảo hành (${pctTxt(r.warranty_pct)})</div><div class="v">${fmt(r.warranty)}</div></div>
        ${r.overhead_manual || r.other_income || r.other_expense || r.cit ? `<div class="kpi"><div class="l">Từ bút toán khác: QLDN / thu khác / chi khác / thuế TNDN</div><div class="v small">${fmt(r.overhead_manual)} / ${fmt(r.other_income)} / ${fmt(r.other_expense)} / ${fmt(r.cit)}</div></div>` : ''}
        <div class="kpi"><div class="l"><b>Lãi ròng tháng</b></div><div class="v ${r.net < 0 ? 'neg' : 'pos'}">${fmt(r.net)}</div></div>
      </div>
      <div class="card"><h2>Chia theo cổ phần</h2><div class="table-wrap"><table><thead><tr><th>Cổ đông</th><th class="num">Tỷ lệ</th><th class="num">Phần lãi/lỗ tháng</th></tr></thead><tbody>
        ${r.shareholders.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${pctTxt(x.pct_bp / 100)}</td><td class="num">${money(x.amount)}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">Đây là lãi quản trị để theo dõi. Việc chia lợi nhuận thực tế theo quyết định của công ty sau khi quyết toán thuế.</p></div>
      <div class="card"><h2>Công trình</h2>${reportProjectsTable(r)}</div>
      <div class="card"><h2>Chi phí chung (TK 6422)</h2><div class="table-wrap"><table><tbody>${ohRows}</tbody><tfoot><tr><td>Cộng</td><td class="num">${fmt(r.overhead_total)}</td></tr></tfoot></table></div></div>
      <div class="card"><h2>Tổng hợp phát sinh tháng</h2><div class="kv">
        <div>Doanh thu (trước thuế)</div><div>${fmt(r.totals.revenue)}</div><div>Thuế GTGT đầu ra</div><div>${fmt(r.totals.vat_out)}</div>
        <div>Chi phí (trước thuế)</div><div>${fmt(r.totals.cost)}</div><div>Thuế GTGT đầu vào</div><div>${fmt(r.totals.vat_in)}${r.totals.vat_in_blocked ? ` (không được khấu trừ: ${fmt(r.totals.vat_in_blocked)})` : ''}</div>
        <div>Thuế GTGT phải nộp (tạm tính)</div><div>${fmt(r.totals.vat_payable ?? 0)}</div>
        <div>Thuế TNCN đã khấu trừ</div><div>${fmt(r.totals.pit_withheld ?? 0)}</div>
        <div>Chi phí không được trừ (thuế TNDN)</div><div>${fmt(r.totals.non_deductible ?? 0)}</div>
        <div>Thu tiền khách</div><div>${fmt(r.totals.receipts)}</div><div>Trả nhà cung cấp</div><div>${fmt(r.totals.payments)}</div>
        <div>Chi phí dở dang cuối tháng (TK 154)</div><div>${fmt(r.wip)}</div></div></div>
      <div class="card"><h2>Ký xác nhận</h2>${d.signoffs.length ? `<ul class="sign-list">${d.signoffs.map(x => `<li><b>${esc(x.full_name)}</b> đã ký lúc ${esc(x.signed_at)}${x.note ? ' — ' + esc(x.note) : ''}</li>`).join('')}</ul>` : '<p class="muted">Chưa ai ký.</p>'}</div>`;
    $('#btnPrint').addEventListener('click', () => window.print());
    $('#btnCsv').addEventListener('click', () => {
      const cats = Object.entries(C().PROJECT_CATEGORIES);
      csvDownload(`bao-cao-${mm}.csv`, [
        [`BÁO CÁO THÁNG ${my(mm)} — ${s.company_name}`], [],
        ['Mã CT', 'Tên', 'Loại', 'DT tháng', 'CP tháng', ...cats.map(([, l]) => l + ' (lũy kế)'), 'DT lũy kế', 'CP lũy kế', 'Lãi gộp lũy kế', '% lãi gộp', 'Phân bổ CP chung + BH', 'Lãi ròng'],
        ...r.projects.map(p => [p.code, p.name, p.kind, p.month.revenue, p.month.cost_total, ...cats.map(([k]) => p.to_date.costs[k] || 0), p.to_date.revenue, p.to_date.cost_total, p.to_date.gross, p.to_date.gross_pct, p.allocated ?? '', p.net ?? '']),
        [], ['Chi phí chung'], ...Object.entries(C().OVERHEAD_CATEGORIES).map(([k, l]) => [l, r.overhead[k] || 0]),
        [], ['Lãi gộp CT nghiệm thu', r.completed_gross], ['Điều chỉnh sau nghiệm thu', r.adjustments], ['Chi phí chung', r.overhead_total], ['Dự phòng bảo hành', r.warranty], ['LÃI RÒNG', r.net],
        [], ['Cổ đông', 'Tỷ lệ %', 'Phần lãi/lỗ'], ...r.shareholders.map(x => [x.name, x.pct_bp / 100, x.amount]),
      ]);
    });
    $('#btnLock')?.addEventListener('click', (ev) => {
      if (!confirm(`Khoá sổ đến hết tháng ${my(mm)}?\n\nSau khi khoá: không ai thêm/sửa chứng từ của tháng này (và các tháng trước). Sai sót chỉ được sửa bằng bút toán điều chỉnh ở tháng sau. Không mở khoá lại được.`)) return;
      once(ev.currentTarget, async () => { const x = await api('POST', '/api/locks', { month: mm }); await loadBoot(); toast(`Đã khoá sổ: ${x.months.map(my).join(', ')}`); load(); });
    });
    $('#btnSign')?.addEventListener('click', (ev) => {
      const note = prompt(`Ký xác nhận số liệu tháng ${my(mm)}. Ghi chú (không bắt buộc):`, 'Đồng ý số liệu');
      if (note === null) return;
      once(ev.currentTarget, async () => { await api('POST', '/api/signoffs', { month: mm, note }); toast('Đã ký xác nhận'); load(); });
    });
  };
  $('#fMonth').addEventListener('change', load);
  await load();
}

async function pageJournal(main) {
  const m = sessionStorage.getItem('jMonth') || thisMonth();
  main.innerHTML = `<div class="page-head"><div><h1>Sổ nhật ký chung</h1><p class="muted">Tự sinh từ chứng từ đã ghi sổ theo TT133: chi phí công trình Nợ 154, chi phí chung Nợ 6422, nghiệm thu kết chuyển 154 → 632, doanh thu Nợ 131 / Có 511, 33311.</p></div>
    <div class="actions"><button class="btn" id="btnCsv">Xuất Excel (CSV)</button></div></div>
    <div class="filters">${monthInput('fMonth', m)}</div><div id="jBox" class="loading">Đang tải…</div>`;
  let data;
  const load = async () => {
    const mm = $('#fMonth').value || thisMonth(); sessionStorage.setItem('jMonth', mm);
    data = await api('GET', `/api/report/journal?m=${mm}`);
    $('#jBox').className = '';
    $('#jBox').innerHTML = `<div class="card"><h2>Tổng phát sinh theo tài khoản</h2><div class="table-wrap"><table><thead><tr><th>TK</th><th class="num">Nợ</th><th class="num">Có</th></tr></thead><tbody>
      ${Object.entries(data.accounts).sort().map(([a, v]) => `<tr><td>${esc(a)}</td><td class="num">${fmt(v.debit)}</td><td class="num">${fmt(v.credit)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>Cộng ${data.total_debit === data.total_credit ? '<span class="pill ok">Cân</span>' : '<span class="pill bad">Lệch</span>'}</td><td class="num">${fmt(data.total_debit)}</td><td class="num">${fmt(data.total_credit)}</td></tr></tfoot></table></div></div>
      <div class="card"><h2>Chi tiết</h2><div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Chứng từ</th><th>Diễn giải</th><th>TK</th><th>Đối tượng</th><th class="num">Nợ</th><th class="num">Có</th></tr></thead><tbody>
      ${data.entries.map(e => e.lines.map((l, i) => `<tr${i ? ' class="sub"' : ''}><td>${i ? '' : dmy(e.date)}</td><td>${i ? '' : esc(e.code)}</td><td>${i ? '' : esc(e.desc)}</td><td>${esc(l.acc)}</td><td>${esc(l.obj)}</td><td class="num">${l.debit ? money(l.debit) : ''}</td><td class="num">${l.credit ? money(l.credit) : ''}</td></tr>`).join('')).join('') || '<tr><td colspan="7" class="muted">Không có phát sinh.</td></tr>'}
      </tbody></table></div></div>`;
  };
  $('#fMonth').addEventListener('change', load);
  $('#btnCsv').addEventListener('click', () => csvDownload(`so-nhat-ky-${data.month}.csv`, [
    ['Ngày', 'Chứng từ', 'Diễn giải', 'TK', 'Đối tượng', 'Nợ', 'Có'],
    ...data.entries.flatMap(e => e.lines.map(l => [e.date, e.code, e.desc, l.acc, l.obj, l.debit, l.credit])),
  ]));
  await load();
}

async function pageAudit(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Nhật ký thao tác</h1><p class="muted">Mọi thao tác thêm, sửa, duyệt, huỷ, khoá sổ, ký đều được ghi lại: ai, lúc nào, trước và sau. Không ai sửa hay xoá được nhật ký.</p></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Lúc</th><th>Người</th><th>Thao tác</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody id="auBody"></tbody></table></div>
    <div class="form-actions"><button class="btn" id="more">Xem thêm</button></div></div>`;
  let last = 0;
  const actLabel = { tao: 'Tạo', sua: 'Sửa', duyet: 'Duyệt', tu_choi: 'Từ chối', huy: 'Huỷ (bút toán đảo)', nhap_hddt: 'Nhập HĐĐT', bo_sung_chung_tu: 'Bổ sung chứng từ', khoa_so: 'Khoá sổ', ky_xac_nhan: 'Ký xác nhận', nghiem_thu: 'Nghiệm thu', mo_lai: 'Mở lại', dang_nhap: 'Đăng nhập', dang_nhap_sai: 'Đăng nhập sai', doi_mat_khau: 'Đổi mật khẩu', dat_lai_mat_khau: 'Đặt lại mật khẩu', thiet_lap: 'Thiết lập' };
  const brief = (j) => { if (!j) return ''; try { const o = JSON.parse(j); return Object.entries(o).slice(0, 8).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); } catch { return j; } };
  const load = async () => {
    const r = await api('GET', `/api/audit${last ? '?before=' + last : ''}`);
    $('#auBody').insertAdjacentHTML('beforeend', r.items.map(a => `<tr><td class="small">${esc(a.at)}</td><td>${esc(userName(a.user_id))}</td><td>${esc(actLabel[a.action] || a.action)}</td><td>${esc(a.entity)} ${esc(a.entity_id)}</td><td class="small muted">${a.before_json ? '<b>Trước:</b> ' + esc(brief(a.before_json)) + '<br>' : ''}${a.after_json ? '<b>Sau:</b> ' + esc(brief(a.after_json)) : ''}</td></tr>`).join(''));
    if (r.items.length) last = r.items[r.items.length - 1].id;
    $('#more').hidden = r.items.length < 200;
  };
  $('#more').addEventListener('click', load);
  await load();
}

// ---------- Đối tác ----------
async function pagePartners(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Nhà cung cấp & khách hàng</h1><p class="muted">INSOLAR được nhận diện theo MST ${esc(S.boot.settings.insolar_mst)} (đổi trong Cài đặt). Nhà cung cấp mới tự tạo khi nhập hoá đơn XML.</p></div>
    <div class="actions"><button class="btn primary" id="addP">+ Thêm</button></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Tên</th><th>Loại</th><th>MST / CCCD</th><th>Địa chỉ</th><th>Điện thoại</th><th></th></tr></thead><tbody>
    ${S.boot.partners.map(p => `<tr><td>${esc(p.name)} ${p.mst && p.mst === S.boot.settings.insolar_mst ? '<span class="pill ok">INSOLAR</span>' : ''}</td><td>${esc(C().PARTNER_KIND[p.kind])}</td><td>${esc(p.mst || (p.id_no ? 'CCCD ' + p.id_no : ''))}</td><td>${esc(p.address)}</td><td>${esc(p.phone)}</td><td><button class="btn sm" data-edit="${p.id}">Sửa</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có.</td></tr>'}
    </tbody></table></div></div>`;
  const form = (p) => {
    const x = p || { kind: 'ncc' };
    const body = openModal(p ? 'Sửa đối tác' : 'Thêm đối tác', `<form id="ptForm"><div class="form-error" hidden></div><div class="form-grid">
      <div class="full"><label>Tên</label><input name="name" value="${esc(x.name || '')}" required></div>
      <div><label>Loại</label><select name="kind">${options(C().PARTNER_KIND, x.kind)}</select></div>
      <div><label>Mã số thuế</label><input name="mst" value="${esc(x.mst || '')}" inputmode="numeric"></div>
      <div class="full"><label>Địa chỉ</label><input name="address" value="${esc(x.address || '')}"></div>
      <div><label>Điện thoại</label><input name="phone" value="${esc(x.phone || '')}"></div>
      <div><label>Số CCCD (cá nhân bán hàng/nhận khoán)</label><input name="id_no" value="${esc(x.id_no || '')}" inputmode="numeric"></div>
    </div><div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">Lưu</button></div></form>`);
    const f = $('#ptForm', body);
    $('[data-close]', f).addEventListener('click', closeModal);
    f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => {
      if (p) await api('PUT', `/api/partners/${p.id}`, { ...formValues(f), version: p.version }); else await api('POST', '/api/partners', formValues(f));
      await loadBoot(); closeModal(); toast('Đã lưu'); route();
    }); });
  };
  $('#addP').addEventListener('click', () => form());
  $$('[data-edit]', main).forEach(b => b.addEventListener('click', () => form(S.boot.partners.find(p => p.id === Number(b.dataset.edit)))));
}

// ---------- Cài đặt ----------
async function pageSettings(main) {
  const s = S.boot.settings;
  main.innerHTML = `<div class="page-head"><div><h1>Cài đặt & người dùng</h1></div></div>
    <div class="card"><h2>Công ty & quy tắc</h2><form id="stForm"><div class="form-error" hidden></div><div class="form-grid">
      <div class="full"><label>Tên công ty</label><input name="company_name" value="${esc(s.company_name)}" required></div>
      <div><label>Mã số thuế</label><input name="company_mst" value="${esc(s.company_mst)}"></div>
      <div><label>Địa chỉ</label><input name="company_address" value="${esc(s.company_address)}"></div>
      <div><label>MST của INSOLAR (để nhận diện vật tư lấy của INSOLAR)</label><input name="insolar_mst" value="${esc(s.insolar_mst)}"></div>
      <div><label>Tên INSOLAR</label><input name="insolar_name" value="${esc(s.insolar_name)}"></div>
      <div><label>Ngưỡng phải duyệt (tổng tiền gồm thuế, đồng)</label><input name="approval_threshold" data-money value="${fmt(s.approval_threshold)}"><div class="field-hint">Khoản lớn hơn ngưỡng phải có người khác duyệt. Khoản do chỉ huy nhập luôn phải duyệt.</div></div>
      <div><label>Dự phòng bảo hành (% doanh thu công trình nghiệm thu)</label><input name="warranty_pct" inputmode="decimal" value="${esc(s.warranty_pct)}"></div>
      <div><label>Ngưỡng bắt buộc chuyển khoản (đồng)</label><input name="cash_limit" data-money value="${fmt(s.cash_limit)}"><div class="field-hint">Hoá đơn từ mức này trả tiền mặt thì thuế GTGT đầu vào không được khấu trừ (Luật Thuế GTGT 2024: 5 triệu).</div></div>
      <div><label>Khấu trừ TNCN thuê khoán: tỷ lệ % / từ mức (đồng)</label><div class="actions"><input name="pit_rate" inputmode="decimal" value="${esc(s.pit_rate)}"><input name="pit_threshold" data-money value="${fmt(s.pit_threshold)}"></div><div class="field-hint">Mặc định 10% cho mỗi lần trả từ 2.000.000đ (TT 111/2013).</div></div>
    </div><div class="form-actions"><button class="btn primary" type="submit">Lưu cài đặt</button></div></form></div>
    <div class="card"><h2>Cổ đông</h2><form id="shForm"><div class="form-error" hidden></div><div id="shRows"></div>
      <button type="button" class="btn sm" id="addSh">+ Thêm cổ đông</button>
      <div class="form-actions"><button class="btn primary" type="submit">Lưu tỷ lệ cổ phần</button></div></form>
      <p class="small muted">Đổi tỷ lệ không làm thay đổi báo cáo các tháng đã khoá sổ (đã lưu ảnh chụp số liệu).</p></div>
    <div class="card"><h2>Người dùng</h2><div class="actions"><button class="btn primary" id="addU">+ Thêm người dùng</button></div>
      <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Tên đăng nhập</th><th>Vai trò</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      ${S.boot.users.map(u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.username)}</td><td>${esc(C().ROLES[u.role])}</td><td>${u.active ? '<span class="pill ok">Hoạt động</span>' : '<span class="pill gray">Đã khoá</span>'}</td>
        <td><button class="btn sm" data-uedit="${u.id}">Sửa</button> <button class="btn sm" data-upw="${u.id}">Đặt lại mật khẩu</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="small muted">
        <p><b>Quản trị</b>: toàn quyền, quản lý người dùng và cài đặt.</p>
        <p><b>Kế toán</b>: nhập/duyệt chi phí, doanh thu, thu chi, nghiệm thu, khoá sổ.</p>
        <p><b>Chỉ huy công trình</b>: chỉ nhập chi phí công trình kèm ảnh chứng từ, chỉ thấy khoản mình nhập; mọi khoản đều chờ duyệt.</p>
        <p><b>Cổ đông</b>: xem toàn bộ sổ sách, báo cáo, nhật ký; duyệt khoản chi; ký xác nhận báo cáo tháng. Không sửa được số liệu.</p></div></div>`;
  const stF = $('#stForm');
  stF.addEventListener('submit', (e) => { e.preventDefault(); submitting(stF, async () => { await api('PUT', '/api/settings', { ...formValues(stF), version: S.boot.settings.version }); await loadBoot(); toast('Đã lưu cài đặt'); }); });
  const rows = $('#shRows');
  const addRow = (name = '', pct = '') => {
    const d = document.createElement('div'); d.className = 'form-grid sh-row';
    d.innerHTML = `<div><label>Tên cổ đông</label><input class="sh-name" value="${esc(name)}"></div><div><label>Tỷ lệ %</label><input class="sh-pct" inputmode="decimal" value="${esc(pct)}"></div>`;
    rows.appendChild(d);
  };
  S.boot.shareholders.forEach(x => addRow(x.name, x.pct_bp / 100));
  if (!S.boot.shareholders.length) addRow();
  $('#addSh').addEventListener('click', () => addRow());
  const shF = $('#shForm');
  shF.addEventListener('submit', (e) => { e.preventDefault(); submitting(shF, async () => {
    await api('PUT', '/api/shareholders', { version: S.boot.settings.shareholders_version, shareholders: $$('.sh-row', shF).map(r => ({ name: $('.sh-name', r).value, pct: $('.sh-pct', r).value })).filter(x => x.name.trim()) });
    await loadBoot(); toast('Đã lưu cổ đông');
  }); });
  const userForm = (u) => {
    const body = openModal(u ? `Sửa ${u.username}` : 'Thêm người dùng', `<form id="uForm"><div class="form-error" hidden></div><div class="form-grid">
      <div><label>Họ tên</label><input name="full_name" value="${esc(u?.full_name || '')}" required></div>
      ${u ? '' : '<div><label>Tên đăng nhập</label><input name="username" required autocapitalize="none"></div>'}
      <div><label>Vai trò</label><select name="role">${options(C().ROLES, u?.role || 'chi_huy')}</select></div>
      ${u ? `<div><label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Đang hoạt động</label></div>` : '<div><label>Mật khẩu (≥ 8 ký tự, có chữ và số)</label><input name="password" type="password" autocomplete="new-password" required></div>'}
    </div><div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">Lưu</button></div></form>`);
    const f = $('#uForm', body);
    $('[data-close]', f).addEventListener('click', closeModal);
    f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => {
      if (u) await api('PUT', `/api/users/${u.id}`, { ...formValues(f), version: u.version }); else await api('POST', '/api/users', formValues(f));
      await loadBoot(); closeModal(); toast('Đã lưu'); route();
    }); });
  };
  $('#addU').addEventListener('click', () => userForm());
  $$('[data-uedit]').forEach(b => b.addEventListener('click', () => userForm(S.boot.users.find(u => u.id === Number(b.dataset.uedit)))));
  $$('[data-upw]').forEach(b => b.addEventListener('click', async () => {
    const pw = prompt('Mật khẩu mới (≥ 8 ký tự, có chữ và số):');
    if (!pw) return;
    try { await api('POST', `/api/users/${b.dataset.upw}/password`, { password: pw }); toast('Đã đặt lại mật khẩu'); } catch (e) { toast(e.message, true); }
  }));
}

async function pageAccount(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Mật khẩu &amp; máy đăng nhập</h1></div></div><div class="card"><form id="pwForm"><div class="form-error" hidden></div><div class="form-grid">
    <div class="full"><label>Mật khẩu hiện tại</label><input type="password" name="old_password" autocomplete="current-password" required></div>
    <div><label>Mật khẩu mới</label><input type="password" name="new_password" autocomplete="new-password" required></div>
    <div><label>Nhập lại mật khẩu mới</label><input type="password" name="new_password2" autocomplete="new-password" required></div>
  </div><div class="form-actions"><button class="btn primary" type="submit">Đổi mật khẩu</button></div></form></div>`;
  main.insertAdjacentHTML('beforeend', `<div class="card"><h2>Các máy đang đăng nhập tài khoản này</h2><div id="sessBox" class="loading">Đang tải…</div>
    <div class="actions mt"><button class="btn danger" id="logoutOthers">Đăng xuất tất cả máy khác</button></div>
    <p class="small muted">Một tài khoản dùng được trên nhiều máy cùng lúc; mọi thao tác ghi đều chống trùng và chống ghi đè. Nếu thấy máy lạ, bấm đăng xuất máy khác rồi đổi mật khẩu.</p></div>`);
  const loadSess = async () => {
    const r = await api('GET', '/api/me/sessions');
    $('#sessBox').className = '';
    $('#sessBox').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Máy</th><th>Đăng nhập lúc</th><th>Dùng gần nhất</th></tr></thead><tbody>
      ${r.items.map(x => `<tr><td>${esc(x.device || 'Không rõ')} ${x.current ? '<span class="pill ok">Máy này</span>' : ''}</td><td>${esc(x.created_at)}</td><td>${esc(x.last_seen)}</td></tr>`).join('')}</tbody></table></div>`;
  };
  $('#logoutOthers').addEventListener('click', (ev) => { if (confirm('Đăng xuất tài khoản này trên tất cả máy khác?')) once(ev.currentTarget, async () => { const r = await api('POST', '/api/me/logout-others', {}); toast(`Đã đăng xuất ${r.count} máy khác`); loadSess(); }); });
  loadSess();
  const f = $('#pwForm');
  f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => {
    const v = formValues(f);
    if (v.new_password !== v.new_password2) throw new Error('Hai lần nhập mật khẩu mới không giống nhau');
    await api('POST', '/api/me/password', v); f.reset(); toast('Đã đổi mật khẩu (các máy khác đã bị đăng xuất)');
  }); });
}

// ---------- Tạm ứng (TK 141) ----------
async function pageAdvances(main) {
  const d = await api('GET', '/api/advances');
  const kindPill = (a) => (a.reverses_id ? '<span class="pill gray">Bút toán đảo</span>' : a.reversed_by_id ? '<span class="pill gray">Đã huỷ</span>' : `<span class="pill ${a.kind === 'cap' ? 'warn' : 'ok'}">${esc(C().ADVANCE_KIND[a.kind])}</span>`);
  main.innerHTML = `<div class="page-head"><div><h1>Tạm ứng</h1><p class="muted">Kế toán cấp tiền tạm ứng (Nợ 141). Người được tạm ứng nhập chi phí với hình thức "Tiền tạm ứng" (Có 141). Tiền thừa nộp lại bằng "Hoàn ứng".</p></div>
    <div class="actions">${can('quan_tri', 'ke_toan') ? '<button class="btn primary" id="addAdv">+ Cấp tạm ứng / hoàn ứng</button>' : ''}${can('chi_huy') ? '<button class="btn primary" id="btnAddCost">+ Nhập chi phí bằng tiền tạm ứng</button>' : ''}</div></div>
    <div class="card"><h2>Số dư tạm ứng</h2><div class="table-wrap"><table><thead><tr><th>Người</th><th class="num">Đã cấp</th><th class="num">Đã chi (đã duyệt)</th><th class="num">Đã hoàn</th><th class="num">Còn giữ</th><th class="num">Chi đang chờ duyệt</th></tr></thead><tbody>
      ${d.balances.map(b => `<tr><td>${esc(b.full_name)}</td><td class="num">${fmt(b.given)}</td><td class="num">${fmt(b.spent)}</td><td class="num">${fmt(b.returned)}</td><td class="num"><b>${money(b.balance)}</b></td><td class="num">${fmt(b.pending)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Chưa có tạm ứng.</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><h2>Phiếu tạm ứng / hoàn ứng</h2><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Ngày</th><th>Người</th><th>Loại</th><th>Hình thức</th><th>Nội dung</th><th class="num">Số tiền</th><th></th></tr></thead><tbody>
      ${d.items.map(a => `<tr><td>${esc(a.code)}</td><td>${dmy(a.date)}</td><td>${esc(userName(a.user_id))}</td><td>${kindPill(a)}</td><td>${esc(C().CASH_METHODS[a.method])}</td><td>${esc(a.description)}</td><td class="num">${money(a.amount)}</td>
        <td>${can('quan_tri', 'ke_toan') && !a.reverses_id && !a.reversed_by_id ? `<button class="btn sm danger" data-void="advances:${a.id}">Huỷ</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Chưa có.</td></tr>'}
    </tbody></table></div></div>`;
  bindCommon(main); bindLedger(main);
  $('#addAdv')?.addEventListener('click', () => {
    const body = openModal('Cấp tạm ứng / hoàn ứng', `<form id="advForm"><div class="form-error" hidden></div><div class="form-grid">
      <div><label>Loại</label><select name="kind">${options(C().ADVANCE_KIND, 'cap')}</select></div>
      <div><label>Ngày</label><input type="date" name="date" value="${today()}" max="${today()}" required></div>
      <div><label>Người nhận / người hoàn</label><select name="user_id" required>${S.boot.users.filter(u => u.active).map(u => `<option value="${u.id}">${esc(u.full_name)} (${esc(C().ROLES[u.role])})</option>`).join('')}</select></div>
      <div><label>Số tiền</label><input name="amount" data-money inputmode="numeric" required></div>
      <div><label>Hình thức</label><select name="method">${options(C().CASH_METHODS, 'chuyen_khoan')}</select></div>
      <div class="full"><label>Nội dung</label><input name="description" placeholder="vd: Tạm ứng mua vật tư công trình CT-2610-01"></div>
      <div class="full"><label>Chứng từ (phiếu chi / uỷ nhiệm chi, không bắt buộc)</label><input type="file" id="advFiles" accept="image/*,application/pdf" multiple></div>
    </div><div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">Lưu</button></div></form>`);
    const f = $('#advForm', body);
    $('[data-close]', f).addEventListener('click', closeModal);
    f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => {
      const v = formValues(f); v.attachments = await readFiles($('#advFiles', f));
      const r = await api('POST', '/api/advances', v); toast(`Đã ghi ${r.code}`); closeModal(); route();
    }); });
  });
}

// ---------- Thuế & bảng kê ----------
async function pageTax(main) {
  const m = sessionStorage.getItem('taxMonth') || prevMonth(thisMonth());
  main.innerHTML = `<div class="page-head"><div><h1>Thuế & bảng kê</h1><p class="muted">Tự tổng hợp từ chứng từ đã ghi sổ: thuế GTGT, Bảng kê hàng hoá/dịch vụ mua không có hoá đơn (mẫu 01/TNDN), thuế TNCN đã khấu trừ, chi phí không được trừ.</p></div></div>
    <div class="filters">${monthInput('fMonth', m)}</div><div id="taxBox" class="loading">Đang tải…</div>`;
  const rowsTable = (rows, cols) => rows.length ? `<div class="table-wrap"><table><thead><tr>${cols.map(c => `<th class="${c[2] || ''}">${esc(c[0])}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr>${cols.map(c => `<td class="${c[2] || ''}">${c[2] === 'num' ? money(r[c[1]]) : esc(c[1] === 'date' ? dmy(r.date) : r[c[1]])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Không có.</p>';
  const load = async () => {
    const mm = $('#fMonth').value || prevMonth(thisMonth()); sessionStorage.setItem('taxMonth', mm);
    const t = await api('GET', `/api/report/tax?m=${mm}`);
    $('#taxBox').className = '';
    $('#taxBox').innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="l">GTGT đầu ra</div><div class="v">${fmt(t.vat.out)}</div></div>
        <div class="kpi"><div class="l">GTGT đầu vào được khấu trừ</div><div class="v">${fmt(t.vat.in_deductible)}</div><div class="l">${t.vat.in_blocked ? 'Không được khấu trừ: ' + fmt(t.vat.in_blocked) : ''}</div></div>
        <div class="kpi"><div class="l">GTGT phải nộp (tạm tính)</div><div class="v ${t.vat.payable < 0 ? 'pos' : ''}">${fmt(t.vat.payable)}</div><div class="l">${t.vat.payable < 0 ? 'Âm = còn được khấu trừ chuyển kỳ sau' : ''}</div></div>
        <div class="kpi"><div class="l">Chi phí không có hoá đơn</div><div class="v">${fmt(t.no_invoice_total)}</div></div>
      </div>
      <div class="card"><div class="page-head"><h2>Bảng kê 01/TNDN — mua hàng hoá, dịch vụ không có hoá đơn</h2><button class="btn sm" id="csvBk">Xuất Excel</button></div>
        <p class="small muted">Người bán là cá nhân/hộ không phải xuất hoá đơn (nông sản, cát đá, vật liệu nhỏ lẻ, thuê dịch vụ…). Kế toán in, ký và lưu cùng chứng từ để được tính vào chi phí được trừ.</p>
        ${rowsTable(t.bang_ke, [['Ngày', 'date'], ['Chứng từ', 'code'], ['Người bán', 'partner'], ['Địa chỉ', 'address'], ['Số CCCD', 'id_no'], ['Hàng hoá, dịch vụ', 'description'], ['Công trình', 'project'], ['Thành tiền', 'amount_net', 'num']])}</div>
      <div class="card"><div class="page-head"><h2>Thuế TNCN đã khấu trừ (thuê khoán cá nhân)</h2><button class="btn sm" id="csvPit">Xuất Excel</button></div>
        <p class="small muted">Nộp số đã khấu trừ theo tờ khai 05/KK-TNCN. Người có cam kết 08/CK-TNCN không bị khấu trừ, vẫn có tên ở đây để quyết toán.</p>
        ${rowsTable(t.pit, [['Ngày', 'date'], ['Chứng từ', 'code'], ['Người nhận', 'partner'], ['Số CCCD', 'id_no'], ['Nội dung', 'description'], ['Tiền công', 'amount_net', 'num'], ['TNCN khấu trừ', 'pit', 'num']])}</div>
      <div class="card"><h2>Thuế GTGT đầu vào KHÔNG được khấu trừ</h2><p class="small muted">Hoá đơn từ ${fmt(t.cash_limit)}đ trả bằng tiền mặt, hoặc chứng từ không phải hoá đơn GTGT có ghi thuế.</p>
        ${rowsTable(t.vat_blocked, [['Ngày', 'date'], ['Chứng từ', 'code'], ['Nhà cung cấp', 'partner'], ['Nội dung', 'description'], ['Trước thuế', 'amount_net', 'num'], ['Thuế GTGT', 'vat', 'num']])}</div>
      <div class="card"><h2>Chi phí không được trừ khi tính thuế TNDN</h2>
        ${rowsTable(t.non_deductible, [['Ngày', 'date'], ['Chứng từ', 'code'], ['Công trình', 'project'], ['Nội dung', 'description'], ['Số tiền', 'amount_net', 'num']])}</div>`;
    $('#csvBk').addEventListener('click', () => csvDownload(`bang-ke-01-TNDN-${mm}.csv`, [
      [`BẢNG KÊ THU MUA HÀNG HOÁ, DỊCH VỤ MUA VÀO KHÔNG CÓ HOÁ ĐƠN — tháng ${my(mm)}`], [`Doanh nghiệp: ${S.boot.settings.company_name} — MST: ${S.boot.settings.company_mst}`], [],
      ['STT', 'Ngày mua', 'Tên người bán', 'Địa chỉ', 'Số CCCD', 'Tên hàng hoá, dịch vụ', 'Thành tiền', 'Chứng từ', 'Công trình'],
      ...t.bang_ke.map((r, i) => [i + 1, r.date, r.partner, r.address, r.id_no, r.description, r.amount_net, r.code, r.project]),
      ['', '', '', '', '', 'Tổng cộng', t.bang_ke.reduce((a, r) => a + r.amount_net, 0)],
    ]));
    $('#csvPit').addEventListener('click', () => csvDownload(`khau-tru-TNCN-${mm}.csv`, [
      ['STT', 'Ngày', 'Họ tên', 'Số CCCD', 'Nội dung', 'Thu nhập', 'Thuế TNCN đã khấu trừ', 'Chứng từ'],
      ...t.pit.map((r, i) => [i + 1, r.date, r.partner, r.id_no, r.description, r.amount_net, r.pit, r.code]),
    ]));
  };
  $('#fMonth').addEventListener('change', load);
  await load();
}

// ---------- Bảng cân đối số phát sinh, sổ cái, sổ quỹ ----------
async function pageTrial(main) {
  const m = sessionStorage.getItem('tbMonth') || thisMonth();
  const acc = sessionStorage.getItem('tbAcc') || '111';
  main.innerHTML = `<div class="page-head"><div><h1>Cân đối số phát sinh & sổ cái</h1><p class="muted">Bấm vào một tài khoản để xem sổ cái. TK 111 là sổ quỹ tiền mặt, TK 112 là sổ tiền gửi ngân hàng.</p></div>
    <div class="actions"><button class="btn" id="csvTb">Xuất Excel</button></div></div>
    <div class="filters">${monthInput('fMonth', m)}</div><div id="tbBox" class="loading">Đang tải…</div><div id="ledBox"></div>`;
  let tb;
  const loadLedger = async (a) => {
    sessionStorage.setItem('tbAcc', a);
    const mm = $('#fMonth').value || thisMonth();
    const l = await api('GET', `/api/report/ledger?acc=${encodeURIComponent(a)}&m=${mm}`);
    $('#ledBox').innerHTML = `<div class="card"><div class="page-head"><h2>Sổ cái TK ${esc(l.acc)} — ${esc(l.name)} — tháng ${my(mm)}</h2><button class="btn sm" id="csvLed">Xuất Excel</button></div>
      <div class="table-wrap"><table><thead><tr><th>Ngày</th><th>Chứng từ</th><th>Diễn giải</th><th>Đối tượng</th><th>TK đối ứng</th><th class="num">Nợ</th><th class="num">Có</th><th class="num">Số dư</th></tr></thead><tbody>
      <tr class="sub"><td colspan="7">Số dư đầu kỳ</td><td class="num">${money(l.opening)}</td></tr>
      ${l.rows.map(r => `<tr><td>${dmy(r.date)}</td><td>${esc(r.code)}</td><td>${esc(r.desc)}</td><td>${esc(r.obj)}</td><td>${esc(r.contra)}</td><td class="num">${r.debit ? money(r.debit) : ''}</td><td class="num">${r.credit ? money(r.credit) : ''}</td><td class="num">${money(r.balance)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="5">Cộng phát sinh / số dư cuối kỳ</td><td class="num">${fmt(l.debit)}</td><td class="num">${fmt(l.credit)}</td><td class="num">${fmt(l.closing)}</td></tr></tfoot></table></div>
      <p class="small muted">Số dư dương là dư Nợ, âm là dư Có.${['111', '112'].includes(l.acc) && l.closing < 0 ? ' <b class="neg">Quỹ âm: thiếu số dư đầu kỳ hoặc thiếu chứng từ thu.</b>' : ''}</p></div>`;
    $('#csvLed').addEventListener('click', () => csvDownload(`so-cai-${l.acc}-${mm}.csv`, [
      ['Ngày', 'Chứng từ', 'Diễn giải', 'Đối tượng', 'TK đối ứng', 'Nợ', 'Có', 'Số dư'], ['', '', 'Số dư đầu kỳ', '', '', '', '', l.opening],
      ...l.rows.map(r => [r.date, r.code, r.desc, r.obj, r.contra, r.debit, r.credit, r.balance]), ['', '', 'Cuối kỳ', '', '', l.debit, l.credit, l.closing],
    ]));
  };
  const load = async () => {
    const mm = $('#fMonth').value || thisMonth(); sessionStorage.setItem('tbMonth', mm);
    tb = await api('GET', `/api/report/trial?m=${mm}`);
    const t = tb.totals;
    $('#tbBox').className = '';
    $('#tbBox').innerHTML = `<div class="card"><h2>Bảng cân đối số phát sinh tháng ${my(mm)}</h2><div class="table-wrap"><table><thead><tr><th>TK</th><th>Tên tài khoản</th><th class="num">Dư Nợ đầu</th><th class="num">Dư Có đầu</th><th class="num">PS Nợ</th><th class="num">PS Có</th><th class="num">Dư Nợ cuối</th><th class="num">Dư Có cuối</th></tr></thead><tbody>
      ${tb.rows.map(r => `<tr class="clickable" data-acc="${esc(r.acc)}"><td><a href="#" data-acc="${esc(r.acc)}">${esc(r.acc)}</a></td><td>${esc(r.name)}</td><td class="num">${fmt(r.open_debit)}</td><td class="num">${fmt(r.open_credit)}</td><td class="num">${fmt(r.debit)}</td><td class="num">${fmt(r.credit)}</td><td class="num">${fmt(r.close_debit)}</td><td class="num">${fmt(r.close_credit)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Chưa có số liệu.</td></tr>'}
      </tbody><tfoot><tr><td colspan="2">Cộng ${t.debit === t.credit && t.close_debit === t.close_credit ? '<span class="pill ok">Cân</span>' : '<span class="pill bad">Lệch</span>'}</td><td class="num">${fmt(t.open_debit)}</td><td class="num">${fmt(t.open_credit)}</td><td class="num">${fmt(t.debit)}</td><td class="num">${fmt(t.credit)}</td><td class="num">${fmt(t.close_debit)}</td><td class="num">${fmt(t.close_credit)}</td></tr></tfoot></table></div>
      <div class="actions mt"><button class="btn sm" data-acc="111">Sổ quỹ tiền mặt (111)</button><button class="btn sm" data-acc="112">Sổ tiền gửi (112)</button><button class="btn sm" data-acc="131">Phải thu (131)</button><button class="btn sm" data-acc="331">Phải trả (331)</button><button class="btn sm" data-acc="141">Tạm ứng (141)</button><button class="btn sm" data-acc="154">Dở dang (154)</button></div></div>`;
    $$('[data-acc]', $('#tbBox')).forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); loadLedger(el.dataset.acc); }));
    await loadLedger(sessionStorage.getItem('tbAcc') || acc);
  };
  $('#fMonth').addEventListener('change', load);
  $('#csvTb').addEventListener('click', () => csvDownload(`can-doi-so-phat-sinh-${tb.month}.csv`, [
    ['TK', 'Tên tài khoản', 'Dư Nợ đầu kỳ', 'Dư Có đầu kỳ', 'Phát sinh Nợ', 'Phát sinh Có', 'Dư Nợ cuối kỳ', 'Dư Có cuối kỳ'],
    ...tb.rows.map(r => [r.acc, r.name, r.open_debit, r.open_credit, r.debit, r.credit, r.close_debit, r.close_credit]),
    ['', 'Cộng', tb.totals.open_debit, tb.totals.open_credit, tb.totals.debit, tb.totals.credit, tb.totals.close_debit, tb.totals.close_credit],
  ]));
  await load();
}

// ---------- Bút toán khác & số dư đầu kỳ ----------
async function pageJournals(main) {
  const d = await api('GET', '/api/journals');
  const A = C().ACCOUNTS;
  main.innerHTML = `<div class="page-head"><div><h1>Bút toán khác & số dư đầu kỳ</h1><p class="muted">Dùng cho nghiệp vụ không thuộc công trình: góp vốn, vay, lãi vay, lương văn phòng (Nợ 6422/Có 334), trả lương, nộp thuế, rút tiền ngân hàng về quỹ, khấu hao… Chi phí và doanh thu công trình KHÔNG nhập ở đây.</p></div>
    <div class="actions">${can('quan_tri', 'ke_toan') ? '<button class="btn" id="addOpen">Nhập số dư đầu kỳ</button><button class="btn primary" id="addJ">+ Bút toán khác</button>' : ''}</div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Mã</th><th>Ngày</th><th>Diễn giải</th><th>TK</th><th>Đối tượng</th><th class="num">Nợ</th><th class="num">Có</th><th></th></tr></thead><tbody>
    ${d.items.map(j => j.lines.map((l, i) => `<tr${i ? ' class="sub"' : ''}><td>${i ? '' : esc(j.code) + (j.kind === 'dau_ky' ? ' <span class="pill gray">Đầu kỳ</span>' : '') + (j.reverses_id ? ' <span class="pill gray">Đảo</span>' : '') + (j.reversed_by_id ? ' <span class="pill gray">Đã huỷ</span>' : '')}</td><td>${i ? '' : dmy(j.date)}</td><td>${i ? '' : esc(j.description)}</td>
      <td title="${esc(A[l.acc] || '')}">${esc(l.acc)}</td><td>${esc(l.obj)}</td><td class="num">${l.debit ? money(l.debit) : ''}</td><td class="num">${l.credit ? money(l.credit) : ''}</td>
      <td>${!i && can('quan_tri', 'ke_toan') && !j.reverses_id && !j.reversed_by_id ? `<button class="btn sm danger" data-void="journals:${j.id}">Huỷ</button>` : ''}</td></tr>`).join('')).join('') || '<tr><td colspan="8" class="muted">Chưa có bút toán.</td></tr>'}
    </tbody></table></div></div>`;
  bindLedger(main);
  const form = (kind) => {
    const accs = kind === 'dau_ky' ? C().OPENING_ACCOUNTS : C().MANUAL_ACCOUNTS;
    const accOpts = `<option value="">— TK —</option>` + accs.map(a => `<option value="${a}">${a} · ${esc(A[a])}</option>`).join('');
    const body = openModal(kind === 'dau_ky' ? 'Số dư đầu kỳ' : 'Bút toán khác', `<form id="jForm"><div class="form-error" hidden></div>
      ${kind === 'dau_ky' ? '<div class="notice small">Nhập số dư các tài khoản tại ngày bắt đầu dùng phần mềm (thường là ngày đầu tháng). Tài sản/phải thu/tiền ghi bên Nợ; nợ phải trả, vốn góp (4111), lợi nhuận chưa phân phối (421) ghi bên Có. Tổng Nợ phải bằng tổng Có.</div>' : ''}
      <div class="form-grid"><div><label>Ngày</label><input type="date" name="date" value="${today()}" max="${today()}" required></div>
      <div><label>Diễn giải</label><input name="description" required value="${kind === 'dau_ky' ? 'Số dư đầu kỳ' : ''}"></div></div>
      <h3>Các dòng</h3><div id="jLines"></div><button type="button" class="btn sm" id="jAdd">+ Thêm dòng</button>
      <p class="small" id="jSum"></p>
      <label class="mt">Chứng từ (không bắt buộc)</label><input type="file" id="jFiles" accept="image/*,application/pdf" multiple>
      <div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">Lưu</button></div></form>`);
    const f = $('#jForm', body);
    const sum = () => {
      const rows = $$('.jl', f);
      const dsum = rows.reduce((a, r) => a + parseMoney($('.jd', r).value), 0), csum = rows.reduce((a, r) => a + parseMoney($('.jc', r).value), 0);
      $('#jSum', f).innerHTML = `Tổng Nợ: <b>${fmt(dsum)}</b> · Tổng Có: <b>${fmt(csum)}</b> ${dsum === csum && dsum > 0 ? '<span class="pill ok">Cân</span>' : '<span class="pill bad">Chưa cân</span>'}`;
    };
    const addLine = () => {
      const d2 = document.createElement('div'); d2.className = 'form-grid jl';
      d2.innerHTML = `<div><label>Tài khoản</label><select class="ja">${accOpts}</select></div><div><label>Đối tượng (tên người, ngân hàng…)</label><input class="jo"></div>
        <div><label>Nợ</label><input class="jd" data-money inputmode="numeric"></div><div><label>Có</label><input class="jc" data-money inputmode="numeric"></div>`;
      $('#jLines', f).appendChild(d2);
    };
    addLine(); addLine();
    $('#jAdd', f).addEventListener('click', addLine);
    f.addEventListener('input', sum);
    $('[data-close]', f).addEventListener('click', closeModal);
    f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => {
      const lines = $$('.jl', f).map(r => ({ acc: $('.ja', r).value, obj: $('.jo', r).value, debit: parseMoney($('.jd', r).value), credit: parseMoney($('.jc', r).value) })).filter(l => l.acc || l.debit || l.credit);
      const r = await api('POST', '/api/journals', { kind, date: $('[name=date]', f).value, description: $('[name=description]', f).value, lines, attachments: await readFiles($('#jFiles', f)) });
      toast(`Đã ghi ${r.code}`); closeModal(); route();
    }); });
  };
  $('#addJ')?.addEventListener('click', () => form('khac'));
  $('#addOpen')?.addEventListener('click', () => form('dau_ky'));
}

function budgetForm(p, s) {
  const body = openModal(`Dự toán ${p.code}`, `<form id="bgForm"><div class="form-error" hidden></div>
    <p class="small muted">Dự toán chi phí (trước thuế) theo từng khoản. Phần mềm so với thực tế và cảnh báo khi vượt.</p>
    <div class="form-grid">${Object.entries(C().PROJECT_CATEGORIES).map(([k, l]) => `<div><label>${esc(l)}</label><input name="${k}" data-money inputmode="numeric" value="${s.budget[k] ? fmt(s.budget[k]) : ''}"></div>`).join('')}</div>
    <p class="small" id="bgSum"></p>
    <div class="form-actions"><button type="button" class="btn" data-close>Huỷ</button><button class="btn primary" type="submit">Lưu dự toán</button></div></form>`);
  const f = $('#bgForm', body);
  const sum = () => { const v = formValues(f); const t = Object.values(v).reduce((a, x) => a + x, 0); $('#bgSum', f).textContent = `Tổng dự toán: ${fmt(t)} đ · Lãi gộp dự kiến: ${fmt(p.contract_value - t)} đ${p.contract_value ? ` (${pctTxt(Math.round((p.contract_value - t) * 10000 / p.contract_value) / 100)})` : ''}`; };
  f.addEventListener('input', sum); sum();
  $('[data-close]', f).addEventListener('click', closeModal);
  f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async () => { await api('PUT', `/api/projects/${p.id}/budget`, { lines: formValues(f), version: p.version }); toast('Đã lưu dự toán'); closeModal(); await loadBoot(); route(); }); });
}

// ---------- Ứng dụng cài trên máy (PWA) + khoá phóng to ----------
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
window.addEventListener('appinstalled', () => { installEvent = null; toast('Đã cài Sổ Công Trình lên máy'); if (S.boot) renderNav(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

// iPhone/iPad bỏ qua user-scalable=no → chặn thêm cử chỉ chụm 2 ngón và chạm đúp.
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 300 && !e.target.closest('input, textarea, select')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

async function pageInstall(main) {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosOther = ios && /CriOS|FxiOS|EdgiOS/.test(ua);
  main.innerHTML = `<div class="page-head"><div><h1>Cài ứng dụng lên máy</h1><p class="muted">Cài một lần, sau đó mở Sổ Công Trình từ biểu tượng trên màn hình như ứng dụng thường, toàn màn hình, không thanh địa chỉ.</p></div></div>
    <div class="card">
      ${isStandalone() ? '<div class="notice ok">Bạn đang dùng bản đã cài.</div>' : ''}
      ${installEvent ? '<p><button class="btn primary" id="doInstall">Cài ứng dụng ngay</button></p>' : ''}
      ${ios ? `<h2>iPhone / iPad</h2>
        ${iosOther ? '<div class="notice">Hãy mở trang này bằng <b>Safari</b> để cài được.</div>' : ''}
        <ol><li>Mở trang này bằng <b>Safari</b>.</li><li>Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên lên) ở thanh dưới.</li><li>Chọn <b>Thêm vào MH chính</b> (Add to Home Screen), bấm <b>Thêm</b>.</li><li>Mở biểu tượng <b>Sổ Công Trình</b> trên màn hình chính.</li></ol>`
      : `<h2>Android (Chrome)</h2><ol><li>${installEvent ? 'Bấm nút <b>Cài ứng dụng ngay</b> ở trên.' : 'Bấm menu <b>⋮</b> góc trên bên phải Chrome.'}</li>${installEvent ? '' : '<li>Chọn <b>Cài đặt ứng dụng</b> (hoặc <b>Thêm vào màn hình chính</b>).</li>'}<li>Mở biểu tượng <b>Sổ Công Trình</b> trên màn hình.</li></ol>
        <h2>Máy tính (Chrome / Edge)</h2><p>${installEvent ? 'Bấm <b>Cài ứng dụng ngay</b> ở trên' : 'Bấm biểu tượng cài đặt (màn hình có mũi tên) ở cuối thanh địa chỉ'}, rồi chọn <b>Cài đặt</b>.</p>`}
      <p class="small muted">Ứng dụng luôn lấy số liệu trực tiếp từ máy chủ và tự cập nhật bản mới, không phải cài lại.</p>
    </div>`;
  $('#doInstall')?.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null; route();
  });
}

// Nhiều người/nhiều máy cùng dùng: 20 giây kiểm tra 1 lần có ai vừa ghi gì không; có thì tự tải lại màn hình
// (không tải lại khi đang mở form hoặc đang gõ — khi đó hiện thông báo để bấm tải lại).
let lastSeq = null, seqTimer = null;
// Sau khi chính máy này ghi xong (và đã tải lại màn hình), lấy mốc mới để không tải lại thêm lần nữa.
function syncSeq() { if (S.boot) api('GET', '/api/changes').then(r => { lastSeq = r.seq; }).catch(() => {}); }
async function checkChanges() {
  if (!S.boot || document.visibilityState !== 'visible') return;
  try {
    const { seq } = await api('GET', '/api/changes');
    if (lastSeq === null) { lastSeq = seq; return; }
    if (seq === lastSeq) return;
    lastSeq = seq;
    const busy = !$('#modalBack').hidden || (document.activeElement && document.activeElement.matches('input, textarea, select'));
    if (busy) { toast('Có người vừa cập nhật dữ liệu. Lưu xong form này rồi số liệu sẽ tự tải lại.'); return; }
    await loadBoot(); await refreshPending(); route({ keepScroll: true });
  } catch { /* mất mạng tạm thời: bỏ qua */ }
}
function startChangeWatch() {
  clearInterval(seqTimer);
  seqTimer = setInterval(checkChanges, 20000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkChanges(); });
startChangeWatch();

start();
