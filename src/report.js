// Tính báo cáo — hàm thuần, chỉ nhận dữ liệu ĐÃ GHI SỔ (status 'da_duyet', gồm cả bút toán đảo mang số âm).
import { PROJECT_CATEGORIES, OVERHEAD_CATEGORIES, PAY_ACCOUNT } from './constants.js';
import { monthEnd, splitByBp } from './util.js';

const sumBy = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const zeroCats = (cats) => Object.fromEntries(Object.keys(cats).map(k => [k, 0]));
const pct = (num, den) => (den ? Math.round(num * 10000 / den) / 100 : 0);
const gross = (r) => r.amount_net + (r.vat || 0);

function acceptedBy(p, date) {
  return p.status === 'da_nghiem_thu' && p.accepted_date && p.accepted_date <= date;
}

export function monthlyReport(data, m) {
  const start = `${m}-01`, end = monthEnd(m);
  const inMonth = (d) => d >= start && d <= end;
  const warrantyPct = Number(data.settings.warranty_pct) || 0;
  const rows = [];
  let completedGross = 0, adjustments = 0, warrantyBase = 0, wip = 0;

  for (const p of data.projects) {
    const pc = data.costs.filter(c => c.project_id === p.id);
    const pr = data.revenues.filter(r => r.project_id === p.id);
    const mCosts = zeroCats(PROJECT_CATEGORIES), tCosts = zeroCats(PROJECT_CATEGORIES);
    pc.forEach(c => {
      if (c.date <= end) tCosts[c.category] = (tCosts[c.category] || 0) + c.amount_net;
      if (inMonth(c.date)) mCosts[c.category] = (mCosts[c.category] || 0) + c.amount_net;
    });
    const mCostTotal = sumBy(Object.values(mCosts), x => x);
    const tCostTotal = sumBy(Object.values(tCosts), x => x);
    const mRev = sumBy(pr.filter(r => inMonth(r.date)), r => r.amount_net);
    const tRev = sumBy(pr.filter(r => r.date <= end), r => r.amount_net);
    const acceptedInMonth = acceptedBy(p, end) && inMonth(p.accepted_date);
    const acceptedBefore = acceptedBy(p, end) && p.accepted_date < start;
    if (!acceptedBy(p, end)) wip += tCostTotal;
    if (!mRev && !mCostTotal && !acceptedInMonth) continue;
    const row = {
      id: p.id, code: p.code, name: p.name, status: p.status, accepted_date: p.accepted_date || '',
      contract_value: p.contract_value,
      month: { revenue: mRev, costs: mCosts, cost_total: mCostTotal },
      to_date: { revenue: tRev, costs: tCosts, cost_total: tCostTotal, gross: tRev - tCostTotal, gross_pct: pct(tRev - tCostTotal, tRev) },
      kind: acceptedInMonth ? 'nghiem_thu' : acceptedBefore ? 'sau_nghiem_thu' : 'do_dang',
      result: 0,
    };
    if (acceptedInMonth) { row.result = tRev - tCostTotal; completedGross += row.result; warrantyBase += tRev; }
    else if (acceptedBefore) { row.result = mRev - mCostTotal; adjustments += row.result; warrantyBase += mRev; }
    rows.push(row);
  }

  const overhead = zeroCats(OVERHEAD_CATEGORIES);
  data.costs.filter(c => c.project_id == null && inMonth(c.date)).forEach(c => { overhead[c.category] = (overhead[c.category] || 0) + c.amount_net; });
  const overheadTotal = sumBy(Object.values(overhead), x => x);
  const warranty = Math.round(warrantyBase * warrantyPct / 100);
  const net = completedGross + adjustments - overheadTotal - warranty;

  // Phân bổ chi phí chung + dự phòng cho các công trình nghiệm thu trong tháng theo doanh thu (chỉ để xem lãi ròng từng công trình).
  const done = rows.filter(r => r.kind === 'nghiem_thu');
  const base = sumBy(done, r => Math.max(r.to_date.revenue, 0));
  if (done.length && base > 0) {
    const alloc = splitByBp(overheadTotal + warranty, done.map(r => Math.max(r.to_date.revenue, 0)));
    done.forEach((r, i) => { r.allocated = alloc[i]; r.net = r.result - alloc[i]; r.net_pct = pct(r.net, r.to_date.revenue); });
  }

  const shareholders = data.shareholders.map(s => ({ name: s.name, pct_bp: s.pct_bp }));
  const shares = splitByBp(net, shareholders.map(s => s.pct_bp));
  shareholders.forEach((s, i) => { s.amount = shareholders.length ? shares[i] : 0; });

  const mc = data.costs.filter(c => inMonth(c.date));
  const mr = data.revenues.filter(r => inMonth(r.date));
  return {
    month: m,
    projects: rows,
    overhead, overhead_total: overheadTotal,
    completed_gross: completedGross, adjustments, warranty_pct: warrantyPct, warranty, net,
    wip,
    shareholders,
    totals: {
      revenue: sumBy(mr, r => r.amount_net), vat_out: sumBy(mr, r => r.vat || 0),
      cost: sumBy(mc, c => c.amount_net), vat_in: sumBy(mc, c => c.vat || 0),
      receipts: sumBy(data.receipts.filter(r => inMonth(r.date)), r => r.amount),
      payments: sumBy(data.payments.filter(r => inMonth(r.date)), r => r.amount),
    },
  };
}

export function projectsSummary(data) {
  return data.projects.map(p => {
    const pc = data.costs.filter(c => c.project_id === p.id);
    const pr = data.revenues.filter(r => r.project_id === p.id);
    const costs = zeroCats(PROJECT_CATEGORIES);
    pc.forEach(c => { costs[c.category] = (costs[c.category] || 0) + c.amount_net; });
    const cost = sumBy(pc, c => c.amount_net);
    const revenue = sumBy(pr, r => r.amount_net);
    const billed = sumBy(pr, gross);
    const received = sumBy(data.receipts.filter(r => r.project_id === p.id), r => r.amount);
    return {
      id: p.id, code: p.code, name: p.name, status: p.status, accepted_date: p.accepted_date || '',
      contract_value: p.contract_value, revenue, costs, cost, gross: revenue - cost, gross_pct: pct(revenue - cost, revenue),
      cost_vs_contract_pct: pct(cost, p.contract_value), billed, received, receivable: billed - received,
    };
  });
}

// Sổ nhật ký chung (TT133) suy ra từ chứng từ đã ghi sổ.
export function journal(data, m) {
  const start = `${m}-01`, end = monthEnd(m);
  const inMonth = (d) => d >= start && d <= end;
  const proj = new Map(data.projects.map(p => [p.id, p]));
  const partner = new Map(data.partners.map(p => [p.id, p]));
  const out = [];
  const push = (date, code, desc, lines) => out.push({ date, code, desc, lines: lines.filter(l => l.debit || l.credit) });

  data.costs.filter(c => inMonth(c.date)).forEach(c => {
    const p = c.project_id != null ? proj.get(c.project_id) : null;
    const acc = p ? (acceptedBy(p, c.date) && c.date > p.accepted_date ? '632' : '154') : '6422';
    const obj = p ? p.code : '';
    const credObj = c.pay_method === 'cong_no' ? (partner.get(c.partner_id)?.name || '') : '';
    push(c.date, c.code, c.description, [
      { acc, obj, debit: c.amount_net, credit: 0 },
      { acc: '1331', obj: '', debit: c.vat || 0, credit: 0 },
      { acc: PAY_ACCOUNT[c.pay_method], obj: credObj, debit: 0, credit: gross(c) },
    ]);
  });
  data.projects.filter(p => p.status === 'da_nghiem_thu' && p.accepted_date && inMonth(p.accepted_date)).forEach(p => {
    const v = sumBy(data.costs.filter(c => c.project_id === p.id && c.date <= p.accepted_date), c => c.amount_net);
    push(p.accepted_date, 'KC-' + p.code, `Kết chuyển giá vốn công trình ${p.code} khi nghiệm thu`, [
      { acc: '632', obj: p.code, debit: v, credit: 0 },
      { acc: '154', obj: p.code, debit: 0, credit: v },
    ]);
  });
  data.revenues.filter(r => inMonth(r.date)).forEach(r => {
    const p = proj.get(r.project_id);
    push(r.date, r.code, r.description, [
      { acc: '131', obj: p ? p.code : '', debit: gross(r), credit: 0 },
      { acc: '511', obj: p ? p.code : '', debit: 0, credit: r.amount_net },
      { acc: '33311', obj: '', debit: 0, credit: r.vat || 0 },
    ]);
  });
  data.receipts.filter(r => inMonth(r.date)).forEach(r => {
    const p = proj.get(r.project_id);
    push(r.date, r.code, r.description || 'Thu tiền khách', [
      { acc: PAY_ACCOUNT[r.method], obj: '', debit: r.amount, credit: 0 },
      { acc: '131', obj: p ? p.code : '', debit: 0, credit: r.amount },
    ]);
  });
  data.payments.filter(r => inMonth(r.date)).forEach(r => {
    push(r.date, r.code, r.description || 'Trả tiền nhà cung cấp', [
      { acc: '331', obj: partner.get(r.partner_id)?.name || '', debit: r.amount, credit: 0 },
      { acc: PAY_ACCOUNT[r.method], obj: '', debit: 0, credit: r.amount },
    ]);
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : 1));
  const accounts = {};
  out.forEach(e => e.lines.forEach(l => {
    const a = accounts[l.acc] || (accounts[l.acc] = { debit: 0, credit: 0 });
    a.debit += l.debit; a.credit += l.credit;
  }));
  const totalDebit = sumBy(Object.values(accounts), a => a.debit);
  const totalCredit = sumBy(Object.values(accounts), a => a.credit);
  return { month: m, entries: out, accounts, total_debit: totalDebit, total_credit: totalCredit };
}

// Công nợ: phải trả từng NCC (chi phí "công nợ" − đã trả) và phải thu từng công trình.
export function balances(data, insolarMst) {
  const suppliers = data.partners.map(pt => {
    const bought = data.costs.filter(c => c.partner_id === pt.id);
    const onCredit = sumBy(bought.filter(c => c.pay_method === 'cong_no'), gross);
    const paid = sumBy(data.payments.filter(p => p.partner_id === pt.id), p => p.amount);
    return {
      id: pt.id, name: pt.name, mst: pt.mst, is_insolar: !!insolarMst && pt.mst === insolarMst,
      purchased: sumBy(bought, gross), on_credit: onCredit, paid, balance: onCredit - paid,
    };
  }).filter(s => s.purchased || s.paid);
  return { suppliers };
}

// Đối chiếu với INSOLAR theo tháng (để hai bên so số liệu, không cần nối hệ thống).
export function insolarReconcile(data, insolarMst) {
  const ids = new Set(data.partners.filter(p => insolarMst && p.mst === insolarMst).map(p => p.id));
  const months = new Set();
  data.costs.forEach(c => { if (ids.has(c.partner_id)) months.add(c.date.slice(0, 7)); });
  data.payments.forEach(p => { if (ids.has(p.partner_id)) months.add(p.date.slice(0, 7)); });
  let bal = 0;
  return [...months].sort().map(m => {
    const c = data.costs.filter(x => ids.has(x.partner_id) && x.date.startsWith(m));
    const purchased = sumBy(c, gross);
    const onCredit = sumBy(c.filter(x => x.pay_method === 'cong_no'), gross);
    const paid = sumBy(data.payments.filter(x => ids.has(x.partner_id) && x.date.startsWith(m)), x => x.amount);
    bal += onCredit - paid;
    return { month: m, invoices: c.length, purchased, on_credit: onCredit, paid, balance_end: bal };
  });
}

export { PAY_ACCOUNT };
