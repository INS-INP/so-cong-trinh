// Service worker: cho phép cài như ứng dụng và mở được giao diện khi mạng chập chờn.
// Luôn lấy bản mới từ mạng trước (để cập nhật ngay khi deploy), chỉ dùng bản lưu khi mất mạng.
// KHÔNG bao giờ lưu dữ liệu /api (số liệu kế toán luôn lấy trực tiếp từ máy chủ).
const CACHE = 'sct-v1';
const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/einvoice.js', '/icon.svg', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
  );
});
