import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, bootstrap, FILE } from './helpers.js';

async function setup() {
  const env = makeEnv('2026-10-15');
  const u = await bootstrap(env);
  const { call } = env;
  const pj = (await call('POST', '/api/projects', { name: 'Hệ 10kW', contract_value: 100000000, start_date: '2026-10-01' }, u.ketoan)).data.id;
  const ind = (await call('POST', '/api/partners', { name: 'Ông Nguyễn Văn A (thợ)', id_no: '038090000001', address: 'Quảng Phú, Thanh Hoá' }, u.ketoan)).data.id;
  const shop = (await call('POST', '/api/partners', { name: 'Chị B bán cát', address: 'Chợ Quảng Phú' }, u.ketoan)).data.id;
  const vendor = (await call('POST', '/api/partners', { name: 'Công ty điện X', mst: '0102030405' }, u.ketoan)).data.id;
  const users = (await call('GET', '/api/bootstrap', null, u.admin)).data.users;
  return { env, u, call, pj, ind, shop, vendor, chihuyId: users.find(x => x.username === 'chihuy').id };
}

test('chi phí không hoá đơn: thuê khoán nhân công tự khấu trừ TNCN 10%, mua của cá nhân lên Bảng kê 01/TNDN', async () => {
  const { u, call, pj, ind, shop } = await setup();
  const base = { date: '2026-10-05', project_id: pj, pay_method: 'tien_mat', attachments: FILE };
  // không hoá đơn GTGT thì không được nhập thuế
  assert.equal((await call('POST', '/api/costs', { ...base, category: 'nhan_cong', evidence: 'nhan_cong_khoan', partner_id: ind, description: 'x', amount_net: 3000000, vat: 300000 }, u.ketoan)).status, 400);
  const nc = await call('POST', '/api/costs', { ...base, category: 'nhan_cong', evidence: 'nhan_cong_khoan', partner_id: ind, description: 'Khoán lắp đặt', amount_net: 5000000 }, u.ketoan);
  assert.equal(nc.status, 200, JSON.stringify(nc.data));
  assert.equal((await call('GET', `/api/costs/${nc.data.id}`, null, u.ketoan)).data.cost.pit, 500000);
  const small = await call('POST', '/api/costs', { ...base, category: 'nhan_cong', evidence: 'nhan_cong_khoan', partner_id: ind, description: 'Phụ việc', amount_net: 1500000 }, u.ketoan);
  assert.equal((await call('GET', `/api/costs/${small.data.id}`, null, u.ketoan)).data.cost.pit, 0, 'dưới 2 triệu không khấu trừ');
  const exempt = await call('POST', '/api/costs', { ...base, category: 'nhan_cong', evidence: 'nhan_cong_khoan', partner_id: ind, description: 'Có cam kết 08', amount_net: 4000000, pit_exempt: true }, u.ketoan);
  assert.equal((await call('GET', `/api/costs/${exempt.data.id}`, null, u.ketoan)).data.cost.pit, 0);
  assert.equal((await call('POST', '/api/costs', { ...base, category: 'vat_tu_ngoai', evidence: 'bang_ke', partner_id: shop, description: 'Cát 2 khối', amount_net: 800000 }, u.ketoan)).status, 200);
  const noDoc = await call('POST', '/api/costs', { ...base, category: 'chi_phi_khac', evidence: 'khong_hop_le', description: 'Bồi dưỡng', amount_net: 300000 }, u.ketoan);
  assert.match(noDoc.data.warnings.join(' '), /không được trừ/);

  const tax = (await call('GET', '/api/report/tax?m=2026-10', null, u.ketoan)).data;
  assert.equal(tax.bang_ke.length, 1);
  assert.equal(tax.bang_ke[0].address, 'Chợ Quảng Phú');
  assert.equal(tax.pit.reduce((a, r) => a + r.pit, 0), 500000);
  assert.equal(tax.non_deductible.length, 1);
  // Sổ nhật ký: Nợ 154 5.000.000 / Có 3335 500.000 / Có 111 4.500.000
  const j = (await call('GET', '/api/report/journal?m=2026-10', null, u.ketoan)).data;
  assert.equal(j.total_debit, j.total_credit);
  assert.equal(j.accounts['3335'].credit, 500000);
});

test('trả tiền mặt từ 5 triệu với hoá đơn GTGT: cảnh báo, thuế đầu vào không được khấu trừ', async () => {
  const { u, call, pj, vendor } = await setup();
  const r = await call('POST', '/api/costs', { date: '2026-10-06', project_id: pj, category: 'vat_tu_ngoai', partner_id: vendor, description: 'Dây cáp', amount_net: 6000000, vat: 480000, pay_method: 'tien_mat', attachments: FILE }, u.ketoan);
  assert.equal(r.status, 200);
  assert.match(r.data.warnings.join(' '), /KHÔNG được khấu trừ/);
  const tax = (await call('GET', '/api/report/tax?m=2026-10', null, u.ketoan)).data;
  assert.equal(tax.vat.in_blocked, 480000);
  assert.equal(tax.vat.in_deductible, 0);
});

test('tạm ứng: cấp, chỉ huy chi bằng tiền tạm ứng, hoàn ứng, số dư và hạch toán 141', async () => {
  const { u, call, pj, vendor, chihuyId } = await setup();
  assert.equal((await call('POST', '/api/advances', { date: '2026-10-02', user_id: chihuyId, kind: 'cap', amount: 10000000, method: 'tien_mat' }, u.chihuy)).status, 403);
  assert.equal((await call('POST', '/api/advances', { date: '2026-10-02', user_id: chihuyId, kind: 'cap', amount: 10000000, method: 'tien_mat' }, u.ketoan)).status, 200);
  const c = await call('POST', '/api/costs', { date: '2026-10-03', project_id: pj, category: 'vat_tu_ngoai', evidence: 'hoa_don_gtgt', partner_id: vendor, description: 'Mua ốc vít', amount_net: 2000000, vat: 160000, pay_method: 'tam_ung', attachments: FILE }, u.chihuy);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  let adv = (await call('GET', '/api/advances', null, u.chihuy)).data.balances[0];
  assert.equal(adv.pending, 2160000);
  assert.equal(adv.balance, 10000000);
  await call('POST', `/api/costs/${c.data.id}/approve`, {}, u.ketoan);
  await call('POST', '/api/advances', { date: '2026-10-10', user_id: chihuyId, kind: 'hoan', amount: 1000000, method: 'tien_mat' }, u.ketoan);
  adv = (await call('GET', '/api/advances', null, u.ketoan)).data.balances.find(b => b.user_id === chihuyId);
  assert.equal(adv.balance, 10000000 - 2160000 - 1000000);
  const tb = (await call('GET', '/api/report/trial?m=2026-10', null, u.ketoan)).data;
  const r141 = tb.rows.find(r => r.acc === '141');
  assert.equal(r141.close_debit, 6840000);
  assert.equal(tb.totals.debit, tb.totals.credit);
  const so = (await call('GET', '/api/report/ledger?acc=111&m=2026-10', null, u.ketoan)).data;
  assert.equal(so.closing, -10000000 + 1000000);
});

test('dự toán công trình: so thực tế, cảnh báo vượt', async () => {
  const { u, call, pj, vendor } = await setup();
  assert.equal((await call('PUT', `/api/projects/${pj}/budget`, { lines: { vat_tu_ngoai: 3000000, nhan_cong: 20000000 } }, u.ketoan)).status, 200);
  const r = await call('POST', '/api/costs', { date: '2026-10-06', project_id: pj, category: 'vat_tu_ngoai', partner_id: vendor, description: 'Vật tư', amount_net: 3500000, vat: 0, evidence: 'hoa_don_ban_hang', pay_method: 'chuyen_khoan', attachments: FILE }, u.ketoan);
  assert.match(r.data.warnings.join(' '), /Vượt dự toán/);
  const p = (await call('GET', '/api/report/projects', null, u.codong)).data.items.find(x => x.id === pj);
  assert.equal(p.budget_total, 23000000);
  assert.deepEqual(p.over_budget, ['vat_tu_ngoai']);
  assert.equal(p.planned_gross, 77000000);
});

test('bút toán khác & số dư đầu kỳ: phải cân, không dùng TK công trình, huỷ bằng bút toán đảo, vào lãi ròng', async () => {
  const { u, call } = await setup();
  const op = await call('POST', '/api/journals', { kind: 'dau_ky', date: '2026-10-01', description: 'Số dư đầu kỳ', lines: [{ acc: '112', debit: 200000000 }, { acc: '4111', credit: 200000000 }] }, u.ketoan);
  assert.equal(op.status, 200, JSON.stringify(op.data));
  assert.equal((await call('POST', '/api/journals', { date: '2026-10-05', description: 'Sai', lines: [{ acc: '112', debit: 1 }, { acc: '4111', credit: 2 }] }, u.ketoan)).status, 400);
  assert.equal((await call('POST', '/api/journals', { date: '2026-10-05', description: 'Lén', lines: [{ acc: '154', debit: 1 }, { acc: '111', credit: 1 }] }, u.ketoan)).status, 400);
  assert.equal((await call('POST', '/api/journals', { kind: 'dau_ky', date: '2026-10-05', description: 'x', lines: [{ acc: '6422', debit: 1 }, { acc: '111', credit: 1 }] }, u.ketoan)).status, 400);
  const sal = await call('POST', '/api/journals', { date: '2026-10-31', description: 'Lương văn phòng T10', lines: [{ acc: '6422', debit: 8000000 }, { acc: '334', credit: 8000000 }] }, u.ketoan);
  assert.equal(sal.status, 400, 'ngày sau hôm nay');
  const sal2 = await call('POST', '/api/journals', { date: '2026-10-15', description: 'Lương văn phòng T10', lines: [{ acc: '6422', debit: 8000000 }, { acc: '334', credit: 8000000 }] }, u.ketoan);
  assert.equal(sal2.status, 200);
  let rep = (await call('GET', '/api/report/month?m=2026-10', null, u.codong)).data.report;
  assert.equal(rep.overhead_manual, 8000000);
  assert.equal(rep.net, -8000000);
  assert.equal((await call('POST', `/api/journals/${sal2.data.id}/void`, { reason: 'Nhầm' }, u.ketoan)).status, 200);
  rep = (await call('GET', '/api/report/month?m=2026-10', null, u.codong)).data.report;
  assert.equal(rep.net, 0);
  const tb = (await call('GET', '/api/report/trial?m=2026-10', null, u.ketoan)).data;
  assert.equal(tb.rows.find(r => r.acc === '112').close_debit, 200000000);
  assert.equal(tb.totals.close_debit, tb.totals.close_credit);
  const nov = (await call('GET', '/api/report/trial?m=2026-11', null, u.ketoan)).data;
  assert.equal(nov.rows.find(r => r.acc === '112').open_debit, 200000000, 'số dư đầu kỳ tháng sau');
});
