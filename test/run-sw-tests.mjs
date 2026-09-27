// sw.js 의 알림 두 갈래(push · notificationclick)를 흉내 낸 self 위에서 돌린다.
// 헤드리스 크롬으로는 알림을 눌러 볼 수 없고, 이 PC 의 헤드리스는 CacheStorage 도
// 안 열려 일꾼이 서지 않는다 — 그래서 판단만 따로 본다.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'sw.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

function worker(windows = []) {
  const H = {}, log = [];
  const self = {
    addEventListener: (t, f) => (H[t] = f),
    registration: { showNotification: async (title, o) => log.push({ show: title, ...o }) },
    clients: { matchAll: async () => windows, openWindow: async u => log.push({ open: u }) },
  };
  new Function('self', 'location', 'caches', src)(self, { origin: 'https://x.test' }, {});
  const fire = async (t, ev) => { let p; ev.waitUntil = x => (p = x); H[t](ev); await p; };
  return { fire, log };
}

console.log('\n── 받기 ──');
{
  const w = worker();
  await w.fire('push', { data: { json: () => ({ t: 'MU', title: 'MU 곡소리 93', body: '본문' }) } });
  const n = w.log[0];
  ok('제목·본문 그대로', n.show === 'MU 곡소리 93' && n.body === '본문', JSON.stringify(n));
  ok('같은 종목은 tag 가 같다', n.tag === 'wail-MU' && n.renotify === true);
  ok('누를 때 쓸 종목을 싣는다', n.data.t === 'MU');
  await w.fire('push', { data: { json: () => { throw new Error('깨짐'); } } });
  await w.fire('push', { data: null });
  ok('깨진 본문·빈 본문도 알림은 띄운다', w.log.length === 3 && w.log[1].show && w.log[2].show);
}

console.log('\n── 누르기 ──');
{
  let closed = 0;
  const w = worker();
  await w.fire('notificationclick', { notification: { data: { t: 'MU' }, close: () => closed++ } });
  ok('열린 창이 없으면 그 종목 실시간을 새로 연다', w.log[0]?.open === '/?t=MU#live', JSON.stringify(w.log));
  ok('알림은 닫는다', closed === 1);

  const got = [];
  const mine = { url: 'https://x.test/#live', focus: async () => got.push('focus'), postMessage: m => got.push(m) };
  const other = { url: 'https://other.test/', focus: async () => got.push('wrong'), postMessage: () => got.push('wrong') };
  const w2 = worker([other, mine]);
  await w2.fire('notificationclick', { notification: { data: { t: 'SNXX' }, close() {} } });
  ok('열린 창이 있으면 그 창을 앞으로', got[0] === 'focus', JSON.stringify(got));
  ok('그 창에 종목을 넘긴다', got[1]?.type === 'open' && got[1]?.t === 'SNXX');
  ok('다른 사이트 창은 건드리지 않는다', !got.includes('wrong') && !w2.log.some(l => l.open));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
