// Đọc file XML hoá đơn điện tử theo chuẩn của Tổng cục Thuế (NĐ 123/2020, TT 78/2021) — chạy được cả trên trình duyệt và máy chủ.
// Không dùng DOMParser để dùng chung được với bộ kiểm thử (Node).

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>';
    if (e === 'quot') return '"'; if (e === 'apos') return "'";
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

export function parseXml(xml) {
  const root = { name: '#root', children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { stack[stack.length - 1].text += decodeEntities(xml.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt); if (e < 0) throw new Error('XML lỗi (chú thích)'); i = e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt); if (e < 0) throw new Error('XML lỗi (CDATA)'); stack[stack.length - 1].text += xml.slice(lt + 9, e); i = e + 3; continue; }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt); if (e < 0) throw new Error('XML lỗi'); i = e + 2; continue; }
    if (xml.startsWith('<!', lt)) { const e = xml.indexOf('>', lt); if (e < 0) throw new Error('XML lỗi'); i = e + 1; continue; }
    const gt = xml.indexOf('>', lt);
    if (gt < 0) throw new Error('XML lỗi (thẻ không đóng)');
    let tag = xml.slice(lt + 1, gt);
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim().split(':').pop();
      const top = stack.pop();
      if (!top || top.name !== name || stack.length === 0) throw new Error('XML lỗi (thẻ đóng không khớp: ' + name + ')');
      i = gt + 1; continue;
    }
    const selfClose = tag.endsWith('/');
    if (selfClose) tag = tag.slice(0, -1);
    const name = tag.trim().split(/\s+/)[0].split(':').pop();
    const node = { name, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
    i = gt + 1;
  }
  if (stack.length !== 1) throw new Error('XML lỗi (thiếu thẻ đóng)');
  return root;
}

function find(node, name) {
  if (node.name === name) return node;
  for (const c of node.children) { const r = find(c, name); if (r) return r; }
  return null;
}
const child = (node, name) => (node ? node.children.find(c => c.name === name) || null : null);
const txt = (node, name) => { const c = child(node, name); return c ? c.text.trim() : ''; };
const num = (s) => {
  const v = Number(String(s || '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

// Trả về dữ liệu hoá đơn đã chuẩn hoá. Tiền làm tròn đồng.
export function parseEInvoice(xml) {
  const root = parseXml(String(xml));
  const hd = find(root, 'HDon');
  const dl = hd && child(hd, 'DLHDon');
  if (!dl) throw new Error('Không phải file XML hoá đơn điện tử theo chuẩn TT78 (không thấy thẻ HDon/DLHDon).');
  const tt = child(dl, 'TTChung');
  const nd = child(dl, 'NDHDon');
  const nb = child(nd, 'NBan'), nm = child(nd, 'NMua');
  const ds = child(nd, 'DSHHDVu');
  const tot = child(nd, 'TToan');
  const lines = (ds ? ds.children.filter(c => c.name === 'HHDVu') : []).map(h => {
    const kind = txt(h, 'TChat') || '1';
    let amount = Math.round(num(txt(h, 'ThTien')));
    if (kind === '3' && amount > 0) amount = -amount; // chiết khấu thương mại
    return {
      kind, name: txt(h, 'THHDVu'), unit: txt(h, 'DVTinh'), qty: num(txt(h, 'SLuong')), price: num(txt(h, 'DGia')),
      amount, vat_rate: txt(h, 'TSuat'),
    };
  }).filter(l => l.kind !== '4' && l.name);
  const net = Math.round(num(txt(tot, 'TgTCThue')));
  const vat = Math.round(num(txt(tot, 'TgTThue')));
  const total = Math.round(num(txt(tot, 'TgTTTBSo')));
  const inv = {
    template: txt(tt, 'KHMSHDon'), series: txt(tt, 'KHHDon'), number: txt(tt, 'SHDon'), date: txt(tt, 'NLap').slice(0, 10),
    seller: { name: txt(nb, 'Ten'), mst: txt(nb, 'MST'), address: txt(nb, 'DChi') },
    buyer: { name: txt(nm, 'Ten'), mst: txt(nm, 'MST'), address: txt(nm, 'DChi') },
    lines, net, vat, total: total || net + vat,
    tax_code: (find(hd, 'MCCQT') || { text: '' }).text.trim(),
  };
  if (!inv.number || !inv.seller.mst) throw new Error('Hoá đơn thiếu số hoá đơn hoặc mã số thuế người bán.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.date)) throw new Error('Hoá đơn thiếu ngày lập.');
  if (!net && lines.length) inv.net = lines.reduce((a, l) => a + l.amount, 0);
  if (Math.abs(inv.net + inv.vat - inv.total) > 1) throw new Error('Tổng tiền hoá đơn không khớp (trước thuế + thuế ≠ tổng thanh toán).');
  inv.key = `${inv.seller.mst}|${inv.template}${inv.series}|${String(Number(inv.number) || inv.number)}`;
  return inv;
}
