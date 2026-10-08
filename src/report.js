// Tính báo cáo — hàm thuần, chỉ nhận dữ liệu ĐÃ GHI SỔ (status 'da_duyet', gồm cả bút toán đảo mang số âm).
import { PROJECT_CATEGORIES, OVERHEAD_CATEGORIES, PAY_ACCOUNT } from './constants.js';
import { ACCOUNTS, PL_INCOME, PL_EXPENSE } from './accounts.js';
import { monthEnd, splitByBp } from './util.js';

const sumBy = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const zeroCats = (cats) => Object.fromEntries(Object.keys(cats).map(k => [k, 0]));
const pct = (num, den) => (den ? Math.round(num * 10000 / den) / 100 : 0);
const gross = (r) => r.amount_net + (r.vat || 0);
const list = (x) => x || [];

function acceptedBy(p, date) {
  return p.status === 'da_nghiem_thu' && p.accepted_date && p.accepted_date <= date;
}
// Thuế GTGT đầu vào chỉ được khấu trừ khi có hoá đơn GTGT và (từ 5 triệu trở lên) thanh toán không dùng tiền mặt.
export function vatBlocked(c, cashLimit) {
  if (!c.vat) return false;
  if ((c.evidence || 'hoa_don_gtgt') !== 'hoa_don_gtgt') return true;
  return c.pay_method === 'tien_mat' && Math.abs(gross(c)) >= cashLimit;
}

// Lãi/lỗ khác từ bút toán nhập tay trong khoảng ngày.
function manualPL(data, inRange) {
  const r = { other_income: 0, other_expense: 0, overhead_manual: 0, cit: 0 };
  list(data.journals).filter(j => inRange(j.date)).forEach(j => j.lines.forEach(l => {
    if (PL_INCOME.includes(l.acc)) r.other_income += l.credit - l.debit;
    else if (PL_EXPENSE.includes(l.acc)) r.other_expense += l.debit - l.credit;
    else if (l.acc === '6422') r.overhead_manual += l.debit - l.credit;
    else if (l.acc === '821') r.cit += l.debit - l.credit;
  }));
  return r;
}

export function monthlyReport(data, m) {
  const start = `${m}-01`, end = monthEnd(m);
  const inMonth = (d) => d >= start && d <= end;
  const warrantyPct = Number(data.settings.warranty_pct) || 0;
  const cashLimit = Number(data.settings.cash_limit) || 0;
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
  const pl = manualPL(data, inMonth);
  const warranty = Math.round(warrantyBase * warrantyPct / 100);
  const net = completedGross + adjustments - overheadTotal - pl.overhead_manual - warranty + pl.other_income - pl.other_expense - pl.cit;

  // Phân bổ chi phí chung + dự phòng cho các công trình nghiệm thu trong tháng theo doanh thu (chỉ để xem lãi ròng từng công trình).
  const done = rows.filter(r => r.kind === 'nghiem_thu');
  const base = sumBy(done, r => Math.max(r.to_date.revenue, 0));
  if (done.length && base > 0) {
    const alloc = splitByBp(overheadTotal + pl.overhead_manual + warranty, done.map(r => Math.max(r.to_date.revenue, 0)));
    done.forEach((r, i) => { r.allocated = alloc[i]; r.net = r.result - alloc[i]; r.net_pct = pct(r.net, r.to_date.revenue); });
  }

  const shareholders = data.shareholders.map(s => ({ name: s.name, pct_bp: s.pct_bp }));
  const shares = splitByBp(net, shareholders.map(s => s.pct_bp));
  shareholders.forEach((s, i) => { s.amount = shareholders.length ? shares[i] : 0; });

  const mc = data.costs.filter(c => inMonth(c.date));
  const mr = data.revenues.filter(r => inMonth(r.date));
  const vatIn = sumBy(mc, c => c.vat || 0);
  const vatBlockedAmt = sumBy(mc.filter(c => vatBlocked(c, cashLimit)), c => c.vat || 0);
  const vatOut = sumBy(mr, r => r.vat || 0);
  return {
    month: m,
    projects: rows,
    overhead, overhead_total: overheadTotal, overhead_manual: pl.overhead_manual,
    other_income: pl.other_income, other_expense: pl.other_expense, cit: pl.cit,
    completed_gross: completedGross, adjustments, warranty_pct: warrantyPct, warranty, net,
    wip,
    shareholders,
    totals: {
      revenue: sumBy(mr, r => r.amount_net), vat_out: vatOut,
      cost: sumBy(mc, c => c.amount_net), vat_in: vatIn, vat_in_blocked: vatBlockedAmt, vat_payable: vatOut - (vatIn - vatBlockedAmt),
      non_deductible: sumBy(mc.filter(c => c.evidence === 'khong_hop_le'), c => c.amount_net),
      pit_withheld: sumBy(mc, c => c.pit || 0),
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
    const budget = zeroCats(PROJECT_CATEGORIES);
    list(data.budgets).filter(b => b.project_id === p.id).forEach(b => { budget[b.category] = b.amount; });
    const budgetTotal = sumBy(Object.values(budget), x => x);
    const cost = sumBy(pc, c => c.amount_net);
    const revenue = sumBy(pr, r => r.amount_net);
    const billed = sumBy(pr, gross);
    const received = sumBy(data.receipts.filter(r => r.project_id === p.id), r => r.amount);
    const over = Object.keys(PROJECT_CATEGORIES).filter(k => budget[k] > 0 && costs[k] > budget[k]);
    return {
      id: p.id, code: p.code, name: p.name, status: p.status, accepted_date: p.accepted_date || '',
      contract_value: p.contract_value, revenue, costs, cost, gross: revenue - cost, gross_pct: pct(revenue - cost, revenue),
      cost_vs_contract_pct: pct(cost, p.contract_value), billed, received, receivable: billed - received,
      budget, budget_total: budgetTotal, budget_used_pct: pct(cost, budgetTotal), over_budget: over,
      planned_gross: budgetTotal ? p.contract_value - budgetTotal : null,
    };
  });
}

// Bút toán (TT133) suy ra từ chứng từ đã ghi sổ trong khoảng ngày [start, end].
export function journalEntries(data, start, end) {
  const inRange = (d) => d >= start && d <= end;
  const proj = new Map(data.projects.map(p => [p.id, p]));
  const partner = new Map(data.partners.map(p => [p.id, p]));
  const user = new Map(list(data.users).map(u => [u.id, u]));
  const out = [];
  const push = (date, code, desc, lines) => out.push({ date, code, desc, lines: lines.filter(l => l.debit || l.credit) });

  data.costs.filter(c => inRange(c.date)).forEach(c => {
    const p = c.project_id != null ? proj.get(c.project_id) : null;
    const acc = p ? (acceptedBy(p, c.date) && c.date > p.accepted_date ? '632' : '154') : '6422';
    const obj = p ? p.code : '';
    const pname = partner.get(c.partner_id)?.name || '';
    const credObj = c.pay_method === 'cong_no' ? pname : c.pay_method === 'tam_ung' ? (user.get(c.advance_user_id)?.full_name || '') : '';
    const pit = c.pit || 0;
    push(c.date, c.code, c.description, [
      { acc, obj, debit: c.amount_net, credit: 0 },
      { acc: '1331', obj: '', debit: c.vat || 0, credit: 0 },
      { acc: '3335', obj: pname, debit: 0, credit: pit },
      { acc: PAY_ACCOUNT[c.pay_method], obj: credObj, debit: 0, credit: gross(c) - pit },
    ]);
  });
  data.projects.filter(p => p.status === 'da_nghiem_thu' && p.accepted_date && inRange(p.accepted_date)).forEach(p => {
    const v = sumBy(data.costs.filter(c => c.project_id === p.id && c.date <= p.accepted_date), c => c.amount_net);
    push(p.accepted_date, 'KC-' + p.code, `Kết chuyển giá vốn công trình ${p.code} khi nghiệm thu`, [
      { acc: '632', obj: p.code, debit: v, credit: 0 },
      { acc: '154', obj: p.code, debit: 0, credit: v },
    ]);
  });
  data.revenues.filter(r => inRange(r.date)).forEach(r => {
    const p = proj.get(r.project_id);
    push(r.date, r.code, r.description, [
      { acc: '131', obj: p ? p.code : '', debit: gross(r), credit: 0 },
      { acc: '511', obj: p ? p.code : '', debit: 0, credit: r.amount_net },
      { acc: '33311', obj: '', debit: 0, credit: r.vat || 0 },
    ]);
  });
  data.receipts.filter(r => inRange(r.date)).forEach(r => {
    const p = proj.get(r.project_id);
    push(r.date, r.code, r.description || 'Thu tiền khách', [
      { acc: PAY_ACCOUNT[r.method], obj: '', debit: r.amount, credit: 0 },
      { acc: '131', obj: p ? p.code : '', debit: 0, credit: r.amount },
    ]);
  });
  data.payments.filter(r => inRange(r.date)).forEach(r => {
    push(r.date, r.code, r.description || 'Trả tiền nhà cung cấp', [
      { acc: '331', obj: partner.get(r.partner_id)?.name || '', debit: r.amount, credit: 0 },
      { acc: PAY_ACCOUNT[r.method], obj: '', debit: 0, credit: r.amount },
    ]);
  });
  list(data.advances).filter(a => inRange(a.date)).forEach(a => {
    const who = user.get(a.user_id)?.full_name || '';
    const cash = PAY_ACCOUNT[a.method];
    push(a.date, a.code, a.description || (a.kind === 'cap' ? `Tạm ứng cho ${who}` : `${who} hoàn ứng`), a.kind === 'cap'
      ? [{ acc: '141', obj: who, debit: a.amount, credit: 0 }, { acc: cash, obj: '', debit: 0, credit: a.amount }]
      : [{ acc: cash, obj: '', debit: a.amount, credit: 0 }, { acc: '141', obj: who, debit: 0, credit: a.amount }]);
  });
  list(data.journals).filter(j => inRange(j.date)).forEach(j => {
    push(j.date, j.code, j.description, j.lines.map(l => ({ acc: l.acc, obj: l.obj || '', debit: l.debit, credit: l.credit })));
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : 1));
  return out;
}

function totalsByAccount(entries) {
  const accounts = {};
  entries.forEach(e => e.lines.forEach(l => {
    const a = accounts[l.acc] || (accounts[l.acc] = { debit: 0, credit: 0 });
    a.debit += l.debit; a.credit += l.credit;
  }));
  return accounts;
}

export function journal(data, m) {
  const entries = journalEntries(data, `${m}-01`, monthEnd(m));
  const accounts = totalsByAccount(entries);
  return {
    month: m, entries, accounts,
    total_debit: sumBy(Object.values(accounts), a => a.debit),
    total_credit: sumBy(Object.values(accounts), a => a.credit),
  };
}

// Bảng cân đối số phát sinh tháng m: số dư đầu kỳ (lũy kế trước tháng), phát sinh trong tháng, số dư cuối kỳ.
export function trialBalance(data, m) {
  const start = `${m}-01`, end = monthEnd(m);
  const before = totalsByAccount(journalEntries(data, '0000-01-01', prevDay(start)));
  const during = totalsByAccount(journalEntries(data, start, end));
  const accs = [...new Set([...Object.keys(before), ...Object.keys(during)])].sort();
  const rows = accs.map(acc => {
    const o = before[acc] || { debit: 0, credit: 0 }, d = during[acc] || { debit: 0, credit: 0 };
    const open = o.debit - o.credit, close = open + d.debit - d.credit;
    return {
      acc, name: ACCOUNTS[acc] || '',
      open_debit: open > 0 ? open : 0, open_credit: open < 0 ? -open : 0,
      debit: d.debit, credit: d.credit,
      close_debit: close > 0 ? close : 0, close_credit: close < 0 ? -close : 0,
    };
  });
  const t = (k) => sumBy(rows, r => r[k]);
  return { month: m, rows, totals: { open_debit: t('open_debit'), open_credit: t('open_credit'), debit: t('debit'), credit: t('credit'), close_debit: t('close_debit'), close_credit: t('close_credit') } };
}
function prevDay(d) {
  const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}

// Sổ cái 1 tài khoản (dùng làm sổ quỹ tiền mặt 111 / tiền gửi 112).
export function ledger(data, acc, m) {
  const start = `${m}-01`, end = monthEnd(m);
  const prev = totalsByAccount(journalEntries(data, '0000-01-01', prevDay(start)))[acc] || { debit: 0, credit: 0 };
  let bal = prev.debit - prev.credit;
  const rows = [];
  journalEntries(data, start, end).forEach(e => {
    const mine = e.lines.filter(l => l.acc === acc);
    if (!mine.length) return;
    const other = [...new Set(e.lines.filter(l => l.acc !== acc).map(l => l.acc))].join(', ');
    mine.forEach(l => { bal += l.debit - l.credit; rows.push({ date: e.date, code: e.code, desc: e.desc, obj: l.obj, contra: other, debit: l.debit, credit: l.credit, balance: bal }); });
  });
  return { acc, name: ACCOUNTS[acc] || '', month: m, opening: prev.debit - prev.credit, rows, closing: bal, debit: sumBy(rows, r => r.debit), credit: sumBy(rows, r => r.credit) };
}

// Thuế tháng: GTGT, Bảng kê 01/TNDN (mua không hoá đơn), TNCN khấu trừ, chi phí không được trừ.
export function taxReport(data, m) {
  const start = `${m}-01`, end = monthEnd(m);
  const inMonth = (d) => d >= start && d <= end;
  const cashLimit = Number(data.settings.cash_limit) || 0;
  const partner = new Map(data.partners.map(p => [p.id, p]));
  const proj = new Map(data.projects.map(p => [p.id, p]));
  const mc = data.costs.filter(c => inMonth(c.date));
  const row = (c) => {
    const pt = partner.get(c.partner_id) || {};
    return { code: c.code, date: c.date, project: c.project_id ? proj.get(c.project_id)?.code || '' : '', description: c.description,
      partner: pt.name || '', mst: pt.mst || '', id_no: pt.id_no || '', address: pt.address || '',
      amount_net: c.amount_net, vat: c.vat || 0, pit: c.pit || 0, pay_method: c.pay_method, evidence: c.evidence || 'hoa_don_gtgt' };
  };
  const vatOut = sumBy(data.revenues.filter(r => inMonth(r.date)), r => r.vat || 0);
  const vatInAll = sumBy(mc, c => c.vat || 0);
  const blocked = mc.filter(c => vatBlocked(c, cashLimit));
  const vatBlockedAmt = sumBy(blocked, c => c.vat || 0);
  return {
    month: m, cash_limit: cashLimit,
    vat: { out: vatOut, in_total: vatInAll, in_blocked: vatBlockedAmt, in_deductible: vatInAll - vatBlockedAmt, payable: vatOut - (vatInAll - vatBlockedAmt) },
    vat_blocked: blocked.map(row),
    bang_ke: mc.filter(c => c.evidence === 'bang_ke').map(row),
    pit: mc.filter(c => c.evidence === 'nhan_cong_khoan').map(row),
    non_deductible: mc.filter(c => c.evidence === 'khong_hop_le').map(row),
    no_invoice_total: sumBy(mc.filter(c => !['hoa_don_gtgt', 'hoa_don_ban_hang'].includes(c.evidence || 'hoa_don_gtgt')), c => c.amount_net),
  };
}

// Số dư tạm ứng từng người: đã cấp − đã chi (khoản chi trả bằng tạm ứng đã ghi sổ) − đã hoàn.
export function advanceBalances(data, pendingCosts = []) {
  return list(data.users).map(u => {
    const adv = list(data.advances).filter(a => a.user_id === u.id);
    const given = sumBy(adv.filter(a => a.kind === 'cap'), a => a.amount);
    const returned = sumBy(adv.filter(a => a.kind === 'hoan'), a => a.amount);
    const spent = sumBy(data.costs.filter(c => c.pay_method === 'tam_ung' && c.advance_user_id === u.id), c => gross(c) - (c.pit || 0));
    const pending = sumBy(pendingCosts.filter(c => c.pay_method === 'tam_ung' && c.advance_user_id === u.id), c => gross(c) - (c.pit || 0));
    return { user_id: u.id, full_name: u.full_name, given, returned, spent, pending, balance: given - returned - spent };
  }).filter(r => r.given || r.returned || r.spent || r.pending);
}

// Công nợ: phải trả từng NCC (chi phí "công nợ" − đã trả) và phải thu từng công trình.
export function balances(data, insolarMst) {
  const suppliers = data.partners.map(pt => {
    const bought = data.costs.filter(c => c.partner_id === pt.id);
    const onCredit = sumBy(bought.filter(c => c.pay_method === 'cong_no'), c => gross(c) - (c.pit || 0));
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
