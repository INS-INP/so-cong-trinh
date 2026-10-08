import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEInvoice } from '../public/einvoice.js';

export function sampleXml({ sellerMst = '2803123637', buyerMst = '0100000001', number = '125', net = 10000000, vat = 800000 } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<HDon><DLHDon Id="data">
  <TTChung><PBan>2.0.1</PBan><THDon>Hóa đơn giá trị gia tăng</THDon><KHMSHDon>1</KHMSHDon><KHHDon>C26TAA</KHHDon><SHDon>${number}</SHDon><NLap>2026-10-05</NLap></TTChung>
  <NDHDon>
    <NBan><Ten>CÔNG TY TNHH NĂNG LƯỢNG XANH INSOLAR VIỆT NAM</Ten><MST>${sellerMst}</MST><DChi>Số 83 Lê Hồng Phong &amp; P. Hạc Thành</DChi></NBan>
    <NMua><Ten>CÔNG TY THI CÔNG</Ten><MST>${buyerMst}</MST><DChi>Thanh Hoá</DChi></NMua>
    <DSHHDVu>
      <HHDVu><TChat>1</TChat><STT>1</STT><THHDVu>Tấm pin LONGi 650W</THHDVu><DVTinh>Tấm</DVTinh><SLuong>4</SLuong><DGia>2000000</DGia><ThTien>8000000</ThTien><TSuat>8%</TSuat></HHDVu>
      <HHDVu><TChat>1</TChat><STT>2</STT><THHDVu><![CDATA[Biến tần <hybrid> 5kW]]></THHDVu><DVTinh>Cái</DVTinh><SLuong>1</SLuong><DGia>2000000</DGia><ThTien>2000000</ThTien><TSuat>8%</TSuat></HHDVu>
      <HHDVu><TChat>4</TChat><THHDVu>Ghi chú: giao tại kho</THHDVu></HHDVu>
    </DSHHDVu>
    <TToan><TgTCThue>${net}</TgTCThue><TgTThue>${vat}</TgTThue><TgTTTBSo>${net + vat}</TgTTTBSo></TToan>
  </NDHDon></DLHDon>
  <MCCQT>00ABCDEF</MCCQT>
  <DSCKS><NBan><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo/></ds:Signature></NBan></DSCKS>
</HDon>`;
}

test('đọc hoá đơn điện tử TT78', () => {
  const inv = parseEInvoice(sampleXml());
  assert.equal(inv.number, '125');
  assert.equal(inv.series, 'C26TAA');
  assert.equal(inv.date, '2026-10-05');
  assert.equal(inv.seller.mst, '2803123637');
  assert.equal(inv.seller.address, 'Số 83 Lê Hồng Phong & P. Hạc Thành');
  assert.equal(inv.net, 10000000);
  assert.equal(inv.vat, 800000);
  assert.equal(inv.total, 10800000);
  assert.equal(inv.lines.length, 2, 'bỏ dòng ghi chú');
  assert.equal(inv.lines[1].name, 'Biến tần <hybrid> 5kW');
  assert.equal(inv.key, '2803123637|1C26TAA|125');
  assert.equal(inv.tax_code, '00ABCDEF');
});

test('từ chối file không phải hoá đơn hoặc tổng không khớp', () => {
  assert.throws(() => parseEInvoice('<root><a>1</a></root>'), /TT78/);
  assert.throws(() => parseEInvoice('<HDon><DLHDon>'), /XML lỗi/);
  const bad = sampleXml().replace('<TgTTTBSo>10800000', '<TgTTTBSo>10900000');
  assert.throws(() => parseEInvoice(bad), /không khớp/);
});
