// 앱으로 설치했을 때 화면 틀을 들고 있는 일꾼.
//
// 시세와 글(/api/*)은 절대 잡지 않는다 — 옛 숫자를 지금 값처럼 보여 주면 안 되고,
// 스트림(SSE)은 가로채면 끊긴다. 잡는 것은 화면 틀(html·아이콘·manifest)뿐이다.
//   화면(html)   망 먼저. 안 되면 들고 있던 것 — 앱이 흰 화면으로 안 뜨게
//   아이콘 등    들고 있던 것 먼저, 뒤에서 새로 받아 둔다
// 틀을 바꾸면 V 를 올린다. 옛 칸은 activate 에서 지운다.
const V = 'shell-v3';
// logo-256.png 는 저장소에 없다(.gitignore). 새로 받은 곳에선 404 라 addAll 이 통째로
// 실패해 일꾼이 아예 안 섰다 — 알림도 여기서 받으니 빼 둔다.
const SHELL = ['/', 'app.webmanifest', 'logo-128.png', 'logo-512.png'];

self.addEventListener('install', e => {
  // 입장 키 쿠키가 있어야 받아진다. 같은 곳이라 쿠키는 저절로 붙는다.
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// ── 곡소리 경보 알림 ──
// 내용은 암호화된 푸시 안에 다 들어 있다. 받는 순간 아무것도 받아 오지 않으니
// 키 쿠키가 없어도 알림은 뜬다. 조용한 푸시는 아이폰이 막으니 받으면 늘 띄운다.
// 같은 종목은 tag 가 같아 쌓이지 않고 덮인다.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data?.json() ?? {}; } catch { /* 깨진 본문이어도 알림은 띄운다 */ }
  const t = typeof d.t === 'string' ? d.t : '';
  e.waitUntil(self.registration.showNotification(d.title ?? '곡소리계산기 경보', {
    body: d.body ?? '', icon: 'logo-512.png', lang: 'ko',
    tag: t ? `wail-${t}` : 'wail', renotify: true, data: { t },
  }));
});

// 누르면 그 종목 실시간으로. 열린 창이 있으면 그 창을 쓰고, 없으면 새로 연다.
// 새 창은 최상위 이동이라 SameSite=Lax 키 쿠키가 붙는다.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const t = e.notification.data?.t ?? '';
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = open.find(c => new URL(c.url).origin === location.origin);
    if (w) { await w.focus(); w.postMessage({ type: 'open', t }); return; }
    await self.clients.openWindow(t ? `/?t=${encodeURIComponent(t)}#live` : '/#live');
  })());
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
