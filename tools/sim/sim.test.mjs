// node tools/sim/sim.test.mjs — 작은 가짜 계열로 진입·청산·수수료·겹침·미래 정보를 잰다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, BAR_MS } from './replay.mjs';
import { signalAt, runTrades, tradeReturn, maxDrawdown, randomBaseline, buyHold, FEE, MIN_N } from './backtest.mjs';

const near = (a, b, e = 1e-12) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

// 봉 i: 시가 100+i, 종가 100+i+0.5
const mkBars = n => Array.from({ length: n }, (_, i) => ({ ms: i * BAR_MS, open: 100 + i, close: 100.5 + i }));
// 비율 r[i], 봉당 댓글 MIN_N 개
const mkRows = ratios => ratios.map((r, i) => ({ t: i * BAR_MS, n: MIN_N, wail: r * MIN_N, wailRatio: r, sent: 0 }));
// 앞 30봉은 0.2/0.3 번갈아(평균 0.25, 표준편차 0.05), 30봉째에 스파이크
const flat = Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.3 : 0.2));

test('replay: 봉 안 댓글만 세고 틈·밖은 버린다', () => {
  const bars = mkBars(2);
  const sc = { isWail: t => t === 'w', sent: t => (t === 'w' ? -1 : 1) };
  const cs = [{ ms: -1, text: 'w' }, { ms: 0, text: 'w' }, { ms: 10, text: 'x' }, { ms: BAR_MS - 1, text: 'x' }, { ms: BAR_MS, text: 'w' }, { ms: 2 * BAR_MS, text: 'w' }];
  const [a, b] = replay(cs, bars, sc);
  assert.deepEqual([a.n, a.wail, a.wailRatio], [3, 1, 1 / 3]);
  near(a.sent, 1 / 3);
  assert.deepEqual([b.n, b.wail, b.wailRatio], [1, 1, 1]);
});

test('신호: 직전 24봉 평균 + k·표준편차를 넘어야 한다', () => {
  const rows = mkRows([...flat, 0.31]);          // 평균 .25, 표준편차 .05 → 문턱 k=1 .30 / 1.5 .325 / 2 .35
  assert.equal(signalAt(rows, 30, 1), true);
  assert.equal(signalAt(rows, 30, 1.5), false);
  assert.equal(signalAt(rows, 30, 2), false);
});

test('신호: 기준선이 모자라거나 댓글이 적으면 없음', () => {
  assert.equal(signalAt(mkRows([...flat.slice(0, 5), 0.9]), 5, 1), false);
  const rows = mkRows([...flat, 0.9]); rows[30].n = MIN_N - 1;
  assert.equal(signalAt(rows, 30, 1), false);
});

test('진입·청산: 신호 다음 봉 시가에 사서 H봉 든 뒤 종가에 판다, 수수료 편도 0.1%', () => {
  const bars = mkBars(40), rows = mkRows([...flat, 0.9, ...Array(9).fill(0.25)]);
  const tr = runTrades(bars, rows, 2, 3);   // k=2: 평범한 봉(최대 1σ)은 신호가 아님
  assert.equal(tr.length, 1);
  assert.deepEqual([tr[0].e, tr[0].x], [31, 33]);   // 신호 30 → 시가 131 → 33봉 종가 133.5
  near(tr[0].ret, (133.5 * (1 - FEE)) / (131 * (1 + FEE)) - 1);
  near(tradeReturn(100, 100), (1 - FEE) / (1 + FEE) - 1);   // 가격이 안 변해도 왕복 비용만큼 잃는다
});

test('겹침: 보유 중에 난 신호는 버리고 끝난 뒤 신호는 받는다', () => {
  const r = [...flat, 0.9, 0.9, 0.9, 0.2, 0.3, 0.2, 0.3, 0.2, 0.9];  // 30,31,32 / 38
  const bars = mkBars(r.length + 2), rows = mkRows(r);
  const tr = runTrades(bars, rows, 2, 3);
  // 30 진입 → 31..33 보유. 31(e=32)·32(e=33) 신호는 겹쳐 버림
  assert.equal(tr[0].e, 31);
  assert.ok(tr.every((t, i) => i === 0 || t.e > tr[i - 1].x));
  assert.ok(tr.length >= 1 && tr.length <= 3);
});

test('끝 봉을 넘는 거래는 만들지 않는다', () => {
  const bars = mkBars(33), rows = mkRows([...flat, 0.9, 0.2, 0.2]);   // e=31, H=12 → x=42 > 32
  assert.equal(runTrades(bars, rows, 2, 12).length, 0);
});

test('미래 정보 안 씀: 봉 i 뒤 값을 바꿔도 i 까지의 신호는 그대로', () => {
  const base = [...flat, 0.9, 0.2, 0.5, 0.1, 0.8];
  const a = mkRows(base), b = mkRows([...base.slice(0, 31), 0.99, 0.0, 0.0, 0.0]);
  for (let i = 0; i <= 30; i++) for (const k of [1, 1.5, 2]) assert.equal(signalAt(a, i, k), signalAt(b, i, k));
  // 봉 i 자신의 값도 기준선에 안 들어간다: i 를 키워도 기준선은 같아 임계는 그대로
  const c = mkRows([...flat, 0.36]);   // 자기 값 .36 이 기준선에 섞였다면 문턱이 올라 놓친다
  assert.equal(signalAt(c, 30, 2), true);
});

test('최대 낙폭·들고 있기', () => {
  near(maxDrawdown([0.1, -0.5, 0.2]), -0.5);
  assert.equal(maxDrawdown([0.1, 0.1]), 0);
  const bars = mkBars(10);
  near(buyHold(bars, 0, 10), tradeReturn(101, 109.5));
});

test('무작위 기준: 시드 고정이라 같은 값, 겹치지 않는 같은 횟수', () => {
  const bars = mkBars(60), rows = mkRows(Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.3 : 0.2)));
  const a = randomBaseline(bars, rows, 3, 4, 0, 60, 50), b = randomBaseline(bars, rows, 3, 4, 0, 60, 50);
  assert.equal(a.mean, b.mean);
  assert.equal(a.sorted.length, 50);
  assert.equal(randomBaseline(bars, rows, 3, 0, 0, 60, 50), null);
});

// ── koru.mjs ──
import { shortReturn, bootstrap, hourCandidates, hourMatchedRandom, events, signalAt as kSignal } from './koru.mjs';

test('koru 숏: 가격 하락만큼 벌고 왕복 비용 2·FEE 를 문다, 롱과 합치면 비용 두 배', () => {
  near(shortReturn(100, 90), 0.1 - 2 * FEE);
  near(shortReturn(100, 100), -2 * FEE);
  near(shortReturn(100, 110), -0.1 - 2 * FEE);
  assert.ok(Math.abs(tradeReturn(100, 110) + shortReturn(100, 110) + 2 * FEE) < 3e-3);   // 롱 ≈ +g - 2f, 숏 = -g - 2f
});

test('koru 부트스트랩: 고정 seed 에서 같은 구간, 평균을 품는다', () => {
  const r = [0.01, -0.02, 0.03, 0.0, -0.01, 0.02];
  const a = bootstrap(r, 200), b = bootstrap(r, 200);
  assert.deepEqual(a, b);
  assert.ok(a.lo <= a.mean && a.mean <= a.hi);
  assert.equal(bootstrap([]), null);
});

test('koru 시간대 맞춘 후보: 같은 hour 의 봉만, 뽑힌 것도 같은 hour', () => {
  const bars = mkBars(120), rows = mkRows(Array.from({ length: 120 }, (_, i) => (i % 2 ? 0.3 : 0.2)));
  const hr = i => new Date(bars[i].ms).getUTCHours();
  const cand = hourCandidates(bars, rows, [5, 17], 3, MIN_N, 0);
  assert.deepEqual([...cand.keys()].sort((a, b) => a - b), [5, 17]);
  for (const [h, idx] of cand) assert.ok(idx.length > 0 && idx.every(i => hr(i) === h));
  const evs = [{ hour: 5, e: 0, x: 0 }, { hour: 17, e: 0, x: 0 }];
  const a = hourMatchedRandom(bars, rows, evs, 3, MIN_N, 0, 40), b = hourMatchedRandom(bars, rows, evs, 3, MIN_N, 0, 40);
  assert.deepEqual(a, b);
  assert.equal(a.long.length, 40);
  assert.equal(hourMatchedRandom(bars, rows, [{ hour: 99 }], 3, MIN_N, 0, 40), null);   // 그 시에 후보가 없다
});

test('koru 사건: 롱·숏이 같은 진입·청산을 쓰고, 신호 종류별로 미래 정보를 안 쓴다', () => {
  const bars = mkBars(40), rows = mkRows([...flat, 0.9, ...Array(9).fill(0.25)]);
  const [t] = events(bars, rows, 'wail', 2, 3, MIN_N, 0);
  near(t.long, tradeReturn(131, 133.5));
  near(t.short, shortReturn(131, 133.5));
  // 댓글 수 신호: 봉 30 의 n 만 키우면 30 에서만 켜지고, 그 뒤 값은 30 의 신호에 영향이 없다
  const nr = mkRows(Array(40).fill(0.2)).map((r, i) => ({ ...r, n: MIN_N + (i % 2) }));
  const withSpike = nr.map((r, i) => (i === 30 ? { ...r, n: 60 } : r));
  assert.equal(kSignal(withSpike, 30, 2, 'n', MIN_N), true);
  const later = withSpike.map((r, i) => (i > 30 ? { ...r, n: 999 } : r));
  assert.equal(kSignal(later, 30, 2, 'n', MIN_N), true);
  assert.equal(kSignal(nr, 30, 2, 'n', MIN_N), false);
});
