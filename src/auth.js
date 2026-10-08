// Mật khẩu: PBKDF2-SHA256 100.000 vòng (giới hạn tối đa của Workers). Phiên: token ngẫu nhiên, chỉ lưu bản băm.
import { bytesToHex, sha256Hex } from './util.js';

const ITER = 100000;

export function randomHex(bytes = 32) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashPassword(password, saltHex = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return { hash: bytesToHex(bits), salt: saltHex };
}

export async function verifyPassword(password, hash, salt) {
  const h = (await hashPassword(password, salt)).hash;
  // so sánh thời gian hằng
  let diff = h.length ^ hash.length;
  for (let i = 0; i < Math.min(h.length, hash.length); i++) diff |= h.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function checkPasswordStrength(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Mật khẩu tối thiểu 8 ký tự';
  if (p.length > 200) return 'Mật khẩu quá dài';
  if (!/[A-Za-zÀ-ỹ]/.test(p) || !/\d/.test(p)) return 'Mật khẩu phải có cả chữ và số';
  return '';
}

export const tokenHash = (t) => sha256Hex('session:' + t);
