import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, bootstrap, FILE } from './helpers.js';

async function setup() {
  const env = makeEnv('2026-10-15');
  const u = await bootstrap(env);
  const pj = (await env.call('POST', '/api/projects', { name: 'CT', start_date: '2026-10-01' }, u.ketoan)).data.id;
  return { ...env, u, pj };
}
const cost = (pj, extra = {}) => ({ date: '2026-10-05', project_id: pj, category: 'chi_phi_khac', evidence: 'noi_bo', description: 'Chi', amount_net: 1000000, pay_method: 'tien_mat', attachments: FILE, ...extra });

test('gửi trùng (bấm 2 lần / mạng gửi lại / 2 máy cùng mã): chỉ ghi 1 lần', async () => {
  const { call, u, pj } = await setup();
  const h = { 'x-idem': 'abcdef1234567890' };
  const [a, b] = await Promise.all([call('POST', '/api/costs', cost(pj), u.ketoan, h), call('POST', '/api/costs', cost(pj), u.ketoan, h)]);
  const ok = [a, b].filter(r => r.status === 200);
  assert.ok(ok.length >= 1);
  const again = await call('POST', '/api/costs', cost(pj), u.ketoan, h);
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('x-idem-replay'), '1');
  assert.equal(again.data.code, ok[0].data.code);
  const list = (await call('GET', '/api/costs', null, u.ketoan)).data.items;
  assert.equal(list.length, 1, 'chỉ có đúng 1 khoản chi');
  // lỗi kiểm tra dữ liệu không bị "nhớ": sửa lại rồi gửi cùng mã vẫn được
  const h2 = { 'x-idem': 'zzzzzzzz00000001' };
  assert.equal((await call('POST', '/api/costs', cost(pj, { amount_net: 0 }), u.ketoan, h2)).status, 400);
  assert.equal((await call('POST', '/api/costs', cost(pj, { amount_net: 2000000 }), u.ketoan, h2)).status, 200);
});

test('chống nhập trùng chứng từ: cùng NCC + số hoá đơn bị chặn; khoản giống hệt vừa nhập phải xác nhận', async () => {
  const { call, u, pj } = await setup();
  const v = (await call('POST', '/api/partners', { name: 'NCC A', mst: '0101010101' }, u.ketoan)).data.id;
  const c1 = cost(pj, { partner_id: v, invoice_no: '0001234', evidence: 'hoa_don_ban_hang', category: 'vat_tu_ngoai' });
  assert.equal((await call('POST', '/api/costs', c1, u.ketoan)).status, 200);
  const dupInv = await call('POST', '/api/costs', { ...c1, amount_net: 5000 }, u.chihuy);
  assert.equal(dupInv.status, 409);
  assert.match(dupInv.data.error, /đã nhập ở CP-/);
  const near = await call('POST', '/api/costs', cost(pj), u.ketoan);
  assert.equal(near.status, 200);
  const near2 = await call('POST', '/api/costs', cost(pj), u.chihuy);
  assert.equal(near2.status, 409);
  assert.equal(near2.data.code, 'possible_duplicate');
  assert.equal((await call('POST', '/api/costs', cost(pj, { allow_duplicate: true }), u.chihuy)).status, 200);
});

test('2 người sửa cùng lúc: người sau bị từ chối, không ghi đè', async () => {
  const { call, u, pj } = await setup();
  const c = (await call('POST', '/api/costs', cost(pj), u.chihuy)).data;
  const v1 = (await call('GET', `/api/costs/${c.id}`, null, u.ketoan)).data.cost.version;
  assert.equal((await call('PUT', `/api/costs/${c.id}`, { ...cost(pj, { amount_net: 1100000 }), version: v1 }, u.ketoan)).status, 200);
  const late = await call('PUT', `/api/costs/${c.id}`, { ...cost(pj, { amount_net: 900000 }), version: v1 }, u.chihuy);
  assert.equal(late.status, 409);
  assert.equal(late.data.code, 'conflict');
  assert.equal((await call('GET', `/api/costs/${c.id}`, null, u.ketoan)).data.cost.amount_net, 1100000);
  // duyệt theo phiên bản cũ (người duyệt đang xem số cũ) → bị từ chối
  assert.equal((await call('POST', `/api/costs/${c.id}/approve`, { version: v1 }, u.codong)).status, 409);
  assert.equal((await call('POST', `/api/costs/${c.id}/approve`, { version: v1 + 1 }, u.codong)).status, 200);
  // công trình
  const p = (await call('GET', '/api/bootstrap', null, u.ketoan)).data.projects.find(x => x.id === pj);
  assert.equal((await call('PUT', `/api/projects/${pj}`, { name: 'CT sửa 1', start_date: '2026-10-01', version: p.version }, u.ketoan)).status, 200);
  assert.equal((await call('PUT', `/api/projects/${pj}`, { name: 'CT sửa 2', start_date: '2026-10-01', version: p.version }, u.admin)).status, 409);
  // cài đặt
  const s = (await call('GET', '/api/bootstrap', null, u.admin)).data.settings;
  assert.equal((await call('PUT', '/api/settings', { company_name: 'A', version: s.version }, u.admin)).status, 200);
  assert.equal((await call('PUT', '/api/settings', { company_name: 'B', version: s.version }, u.admin)).status, 409);
});

test('1 tài khoản đăng nhập 2 máy: cả 2 dùng được, xem danh sách máy, đăng xuất máy khác', async () => {
  const { call, u } = await setup();
  const m2 = (await call('POST', '/api/login', { username: 'codong', password: 'matkhau123' }, null, { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1' })).cookie;
  assert.equal((await call('GET', '/api/bootstrap', null, u.codong)).status, 200);
  assert.equal((await call('GET', '/api/bootstrap', null, m2)).status, 200);
  const ss = (await call('GET', '/api/me/sessions', null, m2)).data.items;
  assert.equal(ss.length, 2);
  assert.ok(ss.some(x => x.current && /iPhone/.test(x.device)));
  assert.equal((await call('POST', '/api/me/logout-others', {}, m2)).data.count, 1);
  assert.equal((await call('GET', '/api/bootstrap', null, u.codong)).status, 401);
  assert.equal((await call('GET', '/api/bootstrap', null, m2)).status, 200);
  const seq1 = (await call('GET', '/api/changes', null, m2)).data.seq;
  await call('POST', '/api/projects', { name: 'Mới' }, u.ketoan);
  assert.ok((await call('GET', '/api/changes', null, m2)).data.seq > seq1, 'máy khác thấy có thay đổi');
});
