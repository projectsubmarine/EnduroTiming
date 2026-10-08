/*
 * sw.js — オンライン版で、電波が無いときでもページ（goal.html / index.html）を開けるようにするサービスワーカー。
 * 画面のファイルだけを端末に保存する（記録データは Firestore のオフライン保存と localStorage が担う）。
 * 通信できるときは常に最新を取りに行き（3秒で諦めて保存済みを使う）、取れたら保存し直す。
 * 画面のファイルを追加したら FILES に足し、VERSION を上げる。
 */
const VERSION = 'v1';
const CACHE = 'enduro-' + VERSION;
const FILES = [
  'index.html', 'goal.html', 'css/style.css',
  'js/core.js', 'js/app.js', 'js/goal.js', 'js/online.js', 'js/firebase-config.js',
  'vendor/firebase/firebase-app-compat.js', 'vendor/firebase/firebase-auth-compat.js', 'vendor/firebase/firebase-firestore-compat.js',
];

self.addEventListener('install', e => {
  // 1つ取れなくても他は保存する（addAll は1つでも失敗すると全部やめてしまうため）
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(FILES.map(f => c.add(f).catch(err => console.warn('保存できませんでした', f, err)))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('enduro-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 同じサイトのGETだけ扱う（Firebaseの通信や /__/ 以下のログイン処理には関与しない）
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/__/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    const timeout = new Promise(ok => setTimeout(ok, 3000));
    try {
      const res = await Promise.race([net, timeout]);
      if (res) return res;
    } catch (_) { /* 通信できない */ }
    const hit = await cache.match(e.request, { ignoreSearch: true })
      || (url.pathname.endsWith('/') ? await cache.match('index.html') : undefined);
    return hit || net;
  })());
});
