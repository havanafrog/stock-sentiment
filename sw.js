// 앱으로 설치했을 때 화면 틀을 들고 있는 일꾼.
//
// 시세와 글(/api/*)은 절대 잡지 않는다 — 옛 숫자를 지금 값처럼 보여 주면 안 되고,
// 스트림(SSE)은 가로채면 끊긴다. 잡는 것은 화면 틀(html·아이콘·manifest)뿐이다.
//   화면(html)   망 먼저. 안 되면 들고 있던 것 — 앱이 흰 화면으로 안 뜨게
//   아이콘 등    들고 있던 것 먼저, 뒤에서 새로 받아 둔다
// 틀을 바꾸면 V 를 올린다. 옛 칸은 activate 에서 지운다.
const V = 'shell-v2';
const SHELL = ['/', 'app.webmanifest', 'logo-128.png', 'logo-256.png', 'logo-512.png'];

self.addEventListener('install', e => {
  // 입장 키 쿠키가 있어야 받아진다. 같은 곳이라 쿠키는 저절로 붙는다.
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request)
      .then(r => { if (r.ok) caches.open(V).then(c => c.put('/', r.clone())); return r; })
      .catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => {
      if (r.ok) caches.open(V).then(c => c.put(e.request, r.clone()));
      return r;
    });
    return hit ?? net;
  }));
});
