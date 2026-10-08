// Tiện ích thuần (không phụ thuộc môi trường).
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => new HttpError(400, msg);

// Giờ Việt Nam (UTC+7), không phụ thuộc múi giờ máy chủ.
export function vnNow(ms = Date.now()) {
  const d = new Date(ms + 7 * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
export const vnToday = (ms) => vnNow(ms).slice(0, 10);

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'))
  && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const monthOf = (d) => String(d).slice(0, 7);
export function nextMonth(m) {
  let [y, mo] = m.split('-').map(Number);
  mo += 1; if (mo > 12) { mo = 1; y += 1; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}
export function monthEnd(m) {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m}-${String(last).padStart(2, '0')}`;
}

// Tiền: số nguyên đồng (VND). Chấp nhận số hoặc chuỗi "1.234.567".
export function toMoney(v, { allowNegative = false, field = 'Số tiền' } = {}) {
  let n = v;
  if (typeof v === 'string') n = Number(v.replace(/[.\s,đ]/g, ''));
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${field} không hợp lệ`);
  n = Math.round(n);
  if (!allowNegative && n < 0) throw bad(`${field} không được âm`);
  if (Math.abs(n) > 1e13) throw bad(`${field} quá lớn`);
  return n;
}
export function str(v, { max = 500, field = 'Trường', required = false } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw bad(`Thiếu ${field}`);
  if (s.length > max) throw bad(`${field} quá dài (tối đa ${max} ký tự)`);
  return s;
}
export function oneOf(v, map, field) {
  if (!Object.prototype.hasOwnProperty.call(map, v)) throw bad(`${field} không hợp lệ`);
  return v;
}

// Chia số nguyên theo tỷ lệ (basis points), phần lẻ dồn vào người cuối để tổng luôn khớp.
export function splitByBp(total, bps) {
  const sum = bps.reduce((a, b) => a + b, 0) || 1;
  let used = 0;
  return bps.map((bp, i) => {
    if (i === bps.length - 1) return total - used;
    const v = Math.round(total * bp / sum);
    used += v; return v;
  });
}

export function b64ToBytes(b64) {
  const bin = atob(String(b64).replace(/^data:[^,]*,/, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256Hex(text) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
