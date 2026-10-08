import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, bootstrap, FILE } from './helpers.js';
import { sampleXml } from './einvoice.test.js';

async function scenario() {
  const env = makeEnv('2026-10-15');
  const u = await bootstrap(env);
  const { call } = env;
  await call('PUT', '/api/settings', { warranty_pct: 1 }, u.admin);
  const pj = await call('POST', '/api/projects', { name: 'Điện mặt trời nhà anh Hùng', contract_value: 100000000, vat_rate: 8, start_date: '2026-09-01' }, u.ketoan);
  assert.equal(pj.status, 200, JSON.stringify(pj.data));
  const projectId = pj.data.id;
  return { env, u, call, projectId };
}

test('thiết lập lần đầu chỉ làm được 1 lần, cần đăng nhập để xem dữ liệu', async () => {
  const env = makeEnv();
  assert.equal((await env.call('GET', '/api/status')).data.setup_done, false);
  await bootstrap(env);
  assert.equal((await env.call('GET', '/api/status')).data.setup_done, true);
  const again = await env.call('POST', '/api/setup', { company_name: 'X', admin_username: 'hack', admin_full_name: 'H', admin_password: 'matkhau123', shareholders: [{ name: 'A', pct: 100 }] });
  assert.equal(again.status, 403);
  assert.equal((await env.call('GET', '/api/bootstrap')).status, 401);
});

test('bảo mật: thiếu header chống giả mạo, khoá đăng nhập khi sai nhiều lần', async () => {
  const env = makeEnv();
  const u = await bootstrap(env);
  const r = await env.call('POST', '/api/projects', { name: 'X' }, u.admin, { 'x-sct': '0' });
  assert.equal(r.status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await env.call('POST', '/api/login', { username: 'ketoan', password: 'sai' })).status, 401);
  assert.equal((await env.call('POST', '/api/login', { username: 'ketoan', password: 'matkhau123' })).status, 429);
  const weak = await env.call('POST', '/api/users', { username: 'yeu', full_name: 'Y', role: 'ke_toan', password: '123' }, u.admin);
  assert.equal(weak.status, 400);
  const notAdmin = await env.call('POST', '/api/users', { username: 'x1', full_name: 'X', role: 'quan_tri', password: 'matkhau123' }, u.ketoan);
  assert.equal(notAdmin.status, 403);
});

test('cổ phần phải đủ 100%', async () => {
  const env = makeEnv();
  const u = await bootstrap(env);
  const r = await env.call('PUT', '/api/shareholders', { shareholders: [{ name: 'A', pct: 50 }, { name: 'B', pct: 40 }] }, u.admin);
  assert.equal(r.status, 400);
});

test('toàn bộ quy trình: chi phí, duyệt, doanh thu, nghiệm thu, báo cáo, khoá sổ, ký, bút toán đảo', async () => {
  const { env, u, call, projectId } = await scenario();

  // 1. Nhập hoá đơn điện tử của INSOLAR → tự nhận NCC INSOLAR + loại "vật tư lấy của INSOLAR"
  const pre = await call('POST', '/api/costs/einvoice-preview', { xml: sampleXml() }, u.ketoan);
  assert.equal(pre.data.is_insolar, true);
  const imp = await call('POST', '/api/costs/einvoice', { xml: sampleXml(), project_id: projectId, pay_method: 'cong_no', date: '2026-09-05' }, u.ketoan);
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  assert.equal(imp.data.status, 'da_duyet', 'dưới ngưỡng, kế toán lập → ghi sổ ngay');
  const dup = await call('POST', '/api/costs/einvoice', { xml: sampleXml(), project_id: projectId, pay_method: 'cong_no' }, u.ketoan);
  assert.equal(dup.status, 409, 'không nhập trùng hoá đơn');
  const wrongBuyer = await call('POST', '/api/costs/einvoice', { xml: sampleXml({ buyerMst: '9999999999', number: '200' }), project_id: projectId }, u.ketoan);
  assert.equal(wrongBuyer.status, 400);
  const cost1 = await call('GET', `/api/costs/${imp.data.id}`, null, u.ketoan);
  assert.equal(cost1.data.cost.category, 'vat_tu_insolar');
  assert.equal(cost1.data.lines.length, 2);
  assert.equal(cost1.data.files[0].mime, 'application/xml');

  // 2. Chỉ huy nhập nhân công → luôn chờ duyệt; bắt buộc có chứng từ
  const noFile = await call('POST', '/api/costs', { date: '2026-09-10', project_id: projectId, category: 'nhan_cong', description: 'Nhân công lắp đặt', amount_net: 15000000, vat: 0, pay_method: 'tien_mat' }, u.chihuy);
  assert.equal(noFile.status, 400);
  const nc = await call('POST', '/api/costs', { date: '2026-09-10', project_id: projectId, category: 'nhan_cong', description: 'Nhân công lắp đặt', amount_net: 15000000, vat: 0, pay_method: 'tien_mat', attachments: FILE }, u.chihuy);
  assert.equal(nc.data.status, 'cho_duyet');
  assert.equal((await call('GET', '/api/report/month?m=2026-09', null, u.chihuy)).status, 403, 'chỉ huy không xem báo cáo');
  const chList = await call('GET', '/api/costs', null, u.chihuy);
  assert.equal(chList.data.items.length, 1, 'chỉ huy chỉ thấy khoản mình lập');
  assert.equal((await call('GET', `/api/costs/${imp.data.id}`, null, u.chihuy)).status, 404);
  assert.equal((await call('POST', `/api/costs/${nc.data.id}/approve`, {}, u.codong)).status, 200, 'cổ đông duyệt được');

  // 3. Khoản lớn hơn ngưỡng → chờ duyệt, người lập không tự duyệt
  const big = await call('POST', '/api/costs', { date: '2026-09-12', project_id: projectId, category: 'may_thue', description: 'Thuê cẩu', amount_net: 25000000, vat: 2000000, pay_method: 'chuyen_khoan', attachments: FILE }, u.ketoan);
  assert.equal(big.data.status, 'cho_duyet');
  assert.equal((await call('POST', `/api/costs/${big.data.id}/approve`, {}, u.ketoan)).status, 400);
  assert.equal((await call('POST', `/api/costs/${big.data.id}/reject`, { reason: 'Sai giá' }, u.admin)).status, 200);

  // 4. Chi phí chung + doanh thu + thu tiền + trả INSOLAR
  assert.equal((await call('POST', '/api/costs', { date: '2026-09-20', category: 'chung_xang_xe', description: 'Xăng xe tháng 9', amount_net: 2000000, vat: 0, pay_method: 'tien_mat', attachments: FILE }, u.ketoan)).status, 200);
  const dt = await call('POST', '/api/revenues', { date: '2026-09-28', project_id: projectId, description: 'Nghiệm thu hệ 10kW', amount_net: 40000000, vat: 3200000, invoice_no: '0000123', attachments: FILE }, u.ketoan);
  assert.equal(dt.status, 200, JSON.stringify(dt.data));
  assert.equal((await call('POST', '/api/receipts', { date: '2026-09-29', project_id: projectId, amount: 20000000, method: 'chuyen_khoan' }, u.ketoan)).status, 200);
  const insolar = (await call('GET', '/api/bootstrap', null, u.ketoan)).data.partners.find(p => p.mst === '2803123637');
  assert.equal((await call('POST', '/api/payments', { date: '2026-09-30', partner_id: insolar.id, amount: 5000000, method: 'chuyen_khoan', attachments: FILE }, u.ketoan)).status, 200);
  assert.equal((await call('POST', `/api/projects/${projectId}/accept`, { date: '2026-09-30' }, u.ketoan)).status, 200);

  // 5. Báo cáo tháng 9
  const rep = (await call('GET', '/api/report/month?m=2026-09', null, u.codong)).data.report;
  const row = rep.projects.find(r => r.id === projectId);
  assert.equal(row.kind, 'nghiem_thu');
  assert.equal(row.to_date.revenue, 40000000);
  assert.equal(row.to_date.cost_total, 25000000);
  assert.equal(row.to_date.costs.vat_tu_insolar, 10000000);
  assert.equal(row.to_date.costs.nhan_cong, 15000000);
  assert.equal(row.result, 15000000);
  assert.equal(row.to_date.gross_pct, 37.5);
  assert.equal(rep.overhead_total, 2000000);
  assert.equal(rep.warranty, 400000);
  assert.equal(rep.net, 12600000);
  assert.deepEqual(rep.shareholders.map(s => s.amount), [7560000, 5040000]);
  assert.equal(row.net, 12600000, 'phân bổ chi phí chung vào công trình nghiệm thu');

  // 6. Sổ nhật ký cân Nợ = Có, có kết chuyển 154 → 632
  const j = (await call('GET', '/api/report/journal?m=2026-09', null, u.ketoan)).data;
  assert.equal(j.total_debit, j.total_credit);
  assert.equal(j.accounts['154'].debit - j.accounts['154'].credit, 0, '154 về 0 sau nghiệm thu');
  assert.equal(j.accounts['632'].debit, 25000000);
  assert.equal(j.accounts['6422'].debit, 2000000);
  assert.equal(j.accounts['511'].credit, 40000000);

  // 7. Công nợ INSOLAR
  const bal = (await call('GET', '/api/report/balances', null, u.codong)).data;
  const ins = bal.suppliers.find(s => s.is_insolar);
  assert.equal(ins.on_credit, 10800000);
  assert.equal(ins.balance, 5800000);
  assert.deepEqual(bal.insolar.map(r => [r.month, r.purchased, r.paid, r.balance_end]), [['2026-09', 10800000, 5000000, 5800000]]);
  assert.equal(bal.projects.find(p => p.id === projectId).receivable, 23200000);

  // 8. Khoá sổ tháng 9 → không ghi thêm vào tháng 9; huỷ chứng từ tháng 9 tạo bút toán đảo ngày hôm nay
  assert.equal((await call('POST', '/api/locks', { month: '2026-10' }, u.ketoan)).status, 400, 'không khoá tháng chưa kết thúc');
  const lk = await call('POST', '/api/locks', { month: '2026-09' }, u.ketoan);
  assert.equal(lk.status, 200, JSON.stringify(lk.data));
  const late = await call('POST', '/api/costs', { date: '2026-09-25', project_id: projectId, category: 'van_chuyen', description: 'x', amount_net: 100000, pay_method: 'tien_mat', attachments: FILE }, u.ketoan);
  assert.equal(late.status, 400);
  const v = await call('POST', `/api/costs/${nc.data.id}/void`, { reason: 'Trùng bảng công' }, u.ketoan);
  assert.equal(v.status, 200, JSON.stringify(v.data));
  const rev = (await call('GET', `/api/costs/${v.data.id}`, null, u.ketoan)).data.cost;
  assert.equal(rev.date, '2026-10-15');
  assert.equal(rev.amount_net, -15000000);
  assert.equal((await call('POST', `/api/costs/${nc.data.id}/void`, { reason: 'lần 2' }, u.ketoan)).status, 400);

  const sep = (await call('GET', '/api/report/month?m=2026-09', null, u.codong)).data;
  assert.equal(sep.locked, true);
  assert.equal(sep.integrity, true, 'số liệu tháng đã khoá không bị thay đổi');
  assert.equal(sep.report.net, 12600000);
  const oct = (await call('GET', '/api/report/month?m=2026-10', null, u.codong)).data.report;
  assert.equal(oct.adjustments, 15000000, 'huỷ nhân công sau nghiệm thu → điều chỉnh tháng 10');
  const jo = (await call('GET', '/api/report/journal?m=2026-10', null, u.ketoan)).data;
  assert.equal(jo.accounts['632'].debit, -15000000);

  // 9. Ký xác nhận
  assert.equal((await call('POST', '/api/signoffs', { month: '2026-10' }, u.codong)).status, 400, 'tháng chưa khoá');
  assert.equal((await call('POST', '/api/signoffs', { month: '2026-09', note: 'Đồng ý' }, u.codong)).status, 200);
  assert.equal((await call('POST', '/api/signoffs', { month: '2026-09' }, u.codong)).status, 400);
  assert.equal((await call('POST', '/api/signoffs', { month: '2026-09' }, u.ketoan)).status, 403);
  const locks = (await call('GET', '/api/locks', null, u.admin)).data;
  assert.equal(locks.items[0].signoffs.length, 1);

  // 10. Nhật ký thao tác ghi đủ
  const audit = (await call('GET', '/api/audit', null, u.codong)).data.items;
  for (const a of ['nhap_hddt', 'duyet', 'tu_choi', 'nghiem_thu', 'khoa_so', 'huy', 'ky_xac_nhan']) {
    assert.ok(audit.some(x => x.action === a), 'thiếu nhật ký ' + a);
  }

  // 11. Chứng từ đính kèm: tải về đúng nội dung, chỉ huy không xem được của người khác
  const fileId = cost1.data.files[0].id;
  const f = await call('GET', `/api/attachments/${fileId}`, null, u.codong);
  assert.equal(f.status, 200);
  assert.match(new TextDecoder().decode(f.data), /<HDon>/);
  assert.equal((await call('GET', `/api/attachments/${fileId}`, null, u.chihuy)).status, 404);
});

test('không nghiệm thu khi còn khoản chờ duyệt; không khoá sổ khi còn khoản chờ duyệt', async () => {
  const { u, call, projectId } = await scenario();
  await call('POST', '/api/costs', { date: '2026-09-10', project_id: projectId, category: 'nhan_cong', description: 'NC', amount_net: 1000000, pay_method: 'tien_mat', attachments: FILE }, u.chihuy);
  assert.equal((await call('POST', `/api/projects/${projectId}/accept`, { date: '2026-09-30' }, u.ketoan)).status, 400);
  assert.equal((await call('POST', '/api/locks', { month: '2026-09' }, u.ketoan)).status, 400);
});

test('vật tư INSOLAR phải chọn đúng NCC INSOLAR; tiền không âm', async () => {
  const { u, call, projectId } = await scenario();
  const other = await call('POST', '/api/partners', { name: 'Cửa hàng điện', mst: '0101010101' }, u.ketoan);
  const r = await call('POST', '/api/costs', { date: '2026-10-01', project_id: projectId, category: 'vat_tu_insolar', partner_id: other.data.id, description: 'Dây', amount_net: 100000, pay_method: 'cong_no', attachments: FILE }, u.ketoan);
  assert.equal(r.status, 400);
  const neg = await call('POST', '/api/costs', { date: '2026-10-01', project_id: projectId, category: 'chi_phi_khac', description: 'x', amount_net: -5, pay_method: 'tien_mat', attachments: FILE }, u.ketoan);
  assert.equal(neg.status, 400);
});
