// 감성·공포·글 수로 다음 거래일 상승/하락을 맞히는 모델 겨루기.
//
//   node tools/bakeoff.mjs              data.js(STOCK_DATA_DIR 또는 ./data)로 겨룬다
//   node tools/bakeoff.mjs --selftest   MLP·CNN 역전파를 수치 미분과 맞춰 본다
//
// 파이썬이 이 PC 에 없고 표본이 400건 남짓이라 전부 순수 JS 로 쓴다(train-nb.mjs 와 같다).
// 평가는 시간 순으로만 나눈다(walk-forward). 날짜 d 를 맞힐 때는 d 전 날짜의 표본만
// 배운다 — 날짜 t 의 정답은 t+1 종가라, t < d 이면 d 가 끝날 때 이미 알려진 값이다.
// 섞어 나누면 같은 날 다른 종목(본주와 레버리지는 거의 같이 움직인다)이 답을 흘린다.
import { readFileSync, existsSync } from 'node:fs';
import { BASELINE_FILE, BASELINE_FALLBACK } from '../paths.mjs';

// ── 자료 ─────────────────────────────────────────────────────
export function loadDays() {
  const f = existsSync(BASELINE_FILE) ? BASELINE_FILE : BASELINE_FALLBACK;
  const w = {};
  new Function('window', readFileSync(f, 'utf8'))(w);
  return { file: f, data: w.STOCK_DATA };
}

const W = 5;                      // 창 길이 — 1D-CNN 이 보는 날 수
const FEATS = ['ret1', 'intra', 'dvol', 'sent', 'sentI', 'dSent', 'fear', 'fearI', 'lp', 'dlp'];
const PRICE = ['ret1', 'intra', 'dvol'];

/** 종목 하루의 특징. 그날까지의 값만 쓴다. 글이 없는 날은 null — 그 표본은 뺀다. */
function featRow(d, i) {
  const x = d[i], p = d[i - 1];
  if (!p || !x.posts || x.sentiment == null || x.fear == null) return null;
  const prev5 = d.slice(Math.max(0, i - 5), i);
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
  const lp = Math.log1p(x.posts);
  return {
    ret1: x.close / p.close - 1,
    intra: x.close / x.open - 1,
    dvol: Math.log1p(x.volume) - avg(prev5.map(r => Math.log1p(r.volume))),
    sent: x.sentiment,
    sentI: x.sentimentIntra ?? x.sentiment,
    dSent: x.sentiment - (p.sentiment ?? x.sentiment),
    fear: x.fear,
    fearI: x.fearIntra ?? x.fear,
    lp,
    dlp: lp - avg(prev5.map(r => Math.log1p(r.posts || 0))),
  };
}

/** 표본: { t, date, y, x(평평한 특징), seq(W×F), px(가격만), prevUp } */
export function samples(data) {
  const out = [];
  for (const t of data.list) {
    const d = data.tickers[t].days;
    const rows = d.map((_, i) => featRow(d, i));
    for (let i = W; i < d.length - 1; i++) {
      const win = rows.slice(i - W + 1, i + 1);
      if (win.some(r => !r)) continue;
      if (d[i + 1].close === d[i].close) continue;          // 보합은 오름도 내림도 아니다
      out.push({
        t, date: d[i].date, y: d[i + 1].close > d[i].close ? 1 : 0,
        x: FEATS.map(k => rows[i][k]),
        px: PRICE.map(k => rows[i][k]),
        seq: win.map(r => FEATS.map(k => r[k])),
        prevUp: rows[i].ret1 > 0 ? 1 : 0,
      });
    }
  }
  return out;
}

// ── 공통 ─────────────────────────────────────────────────────
const sig = z => 1 / (1 + Math.exp(-z));
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }
const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** 학습 표본으로만 평균·표준편차를 잡는다. 시험 표본의 값이 섞이면 미래를 본 것이다. */
function scaler(rows) {
  const F = rows[0].length, mu = new Array(F).fill(0), sd = new Array(F).fill(0);
  for (const r of rows) r.forEach((v, j) => (mu[j] += v / rows.length));
  for (const r of rows) r.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / rows.length));
  const s = sd.map(v => Math.sqrt(v) || 1);
  return r => r.map((v, j) => (v - mu[j]) / s[j]);
}

// Adam — 파라미터를 평평한 Float64Array 하나로 둔다.
function adam(n, lr = 0.01) {
  const m = new Float64Array(n), v = new Float64Array(n); let k = 0;
  return (p, g) => {
    k++;
    for (let i = 0; i < n; i++) {
      m[i] = 0.9 * m[i] + 0.1 * g[i]; v[i] = 0.999 * v[i] + 0.001 * g[i] * g[i];
      p[i] -= lr * (m[i] / (1 - 0.9 ** k)) / (Math.sqrt(v[i] / (1 - 0.999 ** k)) + 1e-8);
    }
  };
}

// ── 로지스틱 ─────────────────────────────────────────────────
export function logistic(X, y, { l2 = 1e-2, iters = 300, lr = 0.1 } = {}) {
  const F = X[0].length, w = new Float64Array(F + 1);
  for (let it = 0; it < iters; it++) {
    const g = new Float64Array(F + 1);
    X.forEach((x, i) => {
      const e = sig(w[F] + x.reduce((s, v, j) => s + v * w[j], 0)) - y[i];
      x.forEach((v, j) => (g[j] += e * v / X.length)); g[F] += e / X.length;
    });
    for (let j = 0; j < F; j++) w[j] -= lr * (g[j] + l2 * w[j]);
    w[F] -= lr * g[F];
  }
  return x => sig(w[F] + x.reduce((s, v, j) => s + v * w[j], 0));
}

// ── 그래디언트 부스팅 (깊이 2 나무) ───────────────────────────
function tree(X, g, idx, depth, minLeaf) {
  const mean = idx.reduce((s, i) => s + g[i], 0) / idx.length;
  if (depth === 0 || idx.length < 2 * minLeaf) return { v: mean };
  let best = null;
  for (let j = 0; j < X[0].length; j++) {
    const vals = idx.map(i => X[i][j]).sort((a, b) => a - b);
    // 자를 자리는 분위수 9개만 본다. 표본이 작아 더 잘게 보면 잡음을 자른다.
    for (let q = 1; q < 10; q++) {
      const th = vals[Math.floor(vals.length * q / 10)];
      const L = idx.filter(i => X[i][j] < th), R = idx.filter(i => X[i][j] >= th);
      if (L.length < minLeaf || R.length < minLeaf) continue;
      const sse = a => { const m = a.reduce((s, i) => s + g[i], 0) / a.length; return a.reduce((s, i) => s + (g[i] - m) ** 2, 0); };
      const e = sse(L) + sse(R);
      if (!best || e < best.e) best = { e, j, th, L, R };
    }
  }
  if (!best) return { v: mean };
  return { j: best.j, th: best.th, l: tree(X, g, best.L, depth - 1, minLeaf), r: tree(X, g, best.R, depth - 1, minLeaf) };
}
const walk = (n, x) => (n.v !== undefined ? n.v : walk(x[n.j] < n.th ? n.l : n.r, x));
export function gbm(X, y, { rounds = 50, lr = 0.1, depth = 2, minLeaf = 10 } = {}) {
  const p0 = Math.log((y.reduce((a, b) => a + b, 0) + 1) / (y.length - y.reduce((a, b) => a + b, 0) + 1));
  const F = y.map(() => p0), trees = [];
  const idx = y.map((_, i) => i);
  for (let r = 0; r < rounds; r++) {
    const g = y.map((v, i) => v - sig(F[i]));             // 로그 손실의 음의 기울기
    const t = tree(X, g, idx, depth, minLeaf);
    trees.push(t); X.forEach((x, i) => (F[i] += lr * walk(t, x)));
  }
  return x => sig(p0 + lr * trees.reduce((s, t) => s + walk(t, x), 0));
}

// ── 작은 MLP: F → H(tanh) → 1 ────────────────────────────────
export function mlpForward(p, x, H) {
  const F = x.length, h = new Array(H);
  for (let k = 0; k < H; k++) { let z = p[F * H + k]; for (let j = 0; j < F; j++) z += p[k * F + j] * x[j]; h[k] = Math.tanh(z); }
  let o = p[F * H + H + H];
  for (let k = 0; k < H; k++) o += p[F * H + H + k] * h[k];
  return { h, o };
}
/** 로그 손실 한 표본의 기울기를 g 에 더한다. */
export function mlpGrad(p, x, y, H, g) {
  const F = x.length, { h, o } = mlpForward(p, x, H);
  const e = sig(o) - y;
  g[F * H + H + H] += e;
  for (let k = 0; k < H; k++) {
    g[F * H + H + k] += e * h[k];
    const dz = e * p[F * H + H + k] * (1 - h[k] * h[k]);
    g[F * H + k] += dz;
    for (let j = 0; j < F; j++) g[k * F + j] += dz * x[j];
  }
}
export function mlp(X, y, { H = 8, epochs = 150, l2 = 1e-3, lr = 0.01, seed = 1 } = {}) {
  const F = X[0].length, n = F * H + H + H + 1, r = rng(seed);
  const p = Float64Array.from({ length: n }, () => gauss(r) * 0.3), step = adam(n, lr);
  for (let ep = 0; ep < epochs; ep++) {
    const g = new Float64Array(n);
    X.forEach((x, i) => mlpGrad(p, x, y[i], H, g));
    for (let i = 0; i < n; i++) g[i] = g[i] / X.length + l2 * p[i];
    step(p, g);
  }
  return x => sig(mlpForward(p, x, H).o);
}

// ── 작은 1D-CNN: 창(W×F) → 필터 C개(폭 K, relu) → 시간 평균 → 1 ──
// 파라미터 배치: 필터 가중치 C·K·F, 필터 절편 C, 출력 가중치 C, 출력 절편 1
export function cnnForward(p, s, C, K) {
  const T = s.length, F = s[0].length, P = T - K + 1;
  const a = [], pooled = new Array(C).fill(0);
  for (let c = 0; c < C; c++) {
    a.push([]);
    for (let t = 0; t < P; t++) {
      let z = p[C * K * F + c];
      for (let k = 0; k < K; k++) for (let j = 0; j < F; j++) z += p[(c * K + k) * F + j] * s[t + k][j];
      const r = Math.max(0, z); a[c].push(z); pooled[c] += r / P;
    }
  }
  let o = p[C * K * F + C + C];
  for (let c = 0; c < C; c++) o += p[C * K * F + C + c] * pooled[c];
  return { a, pooled, o };
}
export function cnnGrad(p, s, y, C, K, g) {
  const T = s.length, F = s[0].length, P = T - K + 1;
  const { a, pooled, o } = cnnForward(p, s, C, K);
  const e = sig(o) - y, base = C * K * F;
  g[base + C + C] += e;
  for (let c = 0; c < C; c++) {
    g[base + C + c] += e * pooled[c];
    const dp = e * p[base + C + c] / P;
    for (let t = 0; t < P; t++) {
      if (a[c][t] <= 0) continue;
      g[base + c] += dp;
      for (let k = 0; k < K; k++) for (let j = 0; j < F; j++) g[(c * K + k) * F + j] += dp * s[t + k][j];
    }
  }
}
export function cnn(S, y, { C = 4, K = 3, epochs = 150, l2 = 1e-3, lr = 0.01, seed = 1 } = {}) {
  const F = S[0][0].length, n = C * K * F + C + C + 1, r = rng(seed);
  const p = Float64Array.from({ length: n }, () => gauss(r) * 0.3), step = adam(n, lr);
  for (let ep = 0; ep < epochs; ep++) {
    const g = new Float64Array(n);
    S.forEach((s, i) => cnnGrad(p, s, y[i], C, K, g));
    for (let i = 0; i < n; i++) g[i] = g[i] / S.length + l2 * p[i];
    step(p, g);
  }
  return s => sig(cnnForward(p, s, C, K).o);
}

// ── 겨루기 ───────────────────────────────────────────────────
const SEEDS = [1, 2, 3, 4, 5];
export const MODELS = {
  '늘 상승 (기준선)': () => () => 1,
  '학습 구간 다수결': tr => { const up = tr.filter(r => r.y).length >= tr.length / 2 ? 1 : 0; return () => up; },
  '어제 방향 그대로': () => r => r.prevUp,
  '로지스틱 · 가격만': tr => { const sc = scaler(tr.map(r => r.px)); const f = logistic(tr.map(r => sc(r.px)), tr.map(r => r.y)); return r => (f(sc(r.px)) > 0.5 ? 1 : 0); },
  '로지스틱': tr => { const sc = scaler(tr.map(r => r.x)); const f = logistic(tr.map(r => sc(r.x)), tr.map(r => r.y)); return r => (f(sc(r.x)) > 0.5 ? 1 : 0); },
  '부스팅 나무 (깊이 2)': tr => { const f = gbm(tr.map(r => r.x), tr.map(r => r.y)); return r => (f(r.x) > 0.5 ? 1 : 0); },
  'MLP (은닉 8)': (tr, seed) => { const sc = scaler(tr.map(r => r.x)); const f = mlp(tr.map(r => sc(r.x)), tr.map(r => r.y), { seed }); return r => (f(sc(r.x)) > 0.5 ? 1 : 0); },
  '1D-CNN (5일 창)': (tr, seed) => {
    const sc = scaler(tr.flatMap(r => r.seq));
    const f = cnn(tr.map(r => r.seq.map(sc)), tr.map(r => r.y), { seed });
    return r => (f(r.seq.map(sc)) > 0.5 ? 1 : 0);
  },
};
const SEEDED = new Set(['MLP (은닉 8)', '1D-CNN (5일 창)']);

/** 날짜마다 그 전 날짜로 배워 그 날짜를 맞힌다. 첫 minTrainDays 날짜는 배우기만 한다. */
export function walkForward(S, fit, { minTrainDays = 15 } = {}) {
  const dates = [...new Set(S.map(r => r.date))].sort();
  const pred = new Map();
  for (let i = minTrainDays; i < dates.length; i++) {
    const tr = S.filter(r => r.date < dates[i]), te = S.filter(r => r.date === dates[i]);
    if (!te.length) continue;
    const f = fit(tr);
    for (const r of te) pred.set(r, f(r));
  }
  return pred;
}

function run() {
  const { file, data } = loadDays();
  const S = samples(data);
  const base = walkForward(S, MODELS['늘 상승 (기준선)']);
  const test = [...base.keys()];
  const n = test.length, upRate = test.filter(r => r.y).length / n;
  const acc = pred => test.filter(r => pred.get(r) === r.y).length / n;
  // 늘 상승과 짝지어 견준다(McNemar). 같은 표본이라 독립 두 비율로 보면 안 된다.
  const mcnemar = pred => {
    let b = 0, c = 0;
    for (const r of test) { const m = pred.get(r) === r.y, o = base.get(r) === r.y; if (m && !o) b++; if (!m && o) c++; }
    return b + c ? (b - c) / Math.sqrt(b + c) : 0;
  };
  const pct = x => (x * 100).toFixed(1);
  const tickers = [...new Set(test.map(r => r.t))];
  const dates = [...new Set(test.map(r => r.date))].sort();

  console.log(`자료 ${file} · 만든 때 ${data.builtAt}`);
  console.log(`표본 ${S.length}건(종목 ${new Set(S.map(r => r.t)).size}) · 시험 ${n}건 = 종목 ${tickers.length} × 날짜 ${dates.length} (${dates[0]} ~ ${dates.at(-1)})`);
  console.log(`시험 구간 실제 상승 비율 ${pct(upRate)}% · 95% 오차 막대 ±${pct(1.96 * Math.sqrt(0.25 / n))}%p\n`);
  console.log('| 모델 | 정확도 | 늘 상승 대비 | McNemar z |');
  console.log('|---|---|---|---|');
  const rows = [];
  for (const [name, fit] of Object.entries(MODELS)) {
    let a, z, spread = '';
    if (SEEDED.has(name)) {
      const accs = [], zs = [];
      for (const seed of SEEDS) { const p = walkForward(S, tr => fit(tr, seed)); accs.push(acc(p)); zs.push(mcnemar(p)); }
      a = accs.reduce((s, v) => s + v, 0) / accs.length; z = zs.reduce((s, v) => s + v, 0) / zs.length;
      spread = ` (시드 5개 평균, ${pct(Math.min(...accs))}~${pct(Math.max(...accs))})`;
    } else { const p = walkForward(S, fit); a = acc(p); z = mcnemar(p); }
    rows.push({ name, a, z });
    console.log(`| ${name} | ${pct(a)}%${spread} | ${a - upRate >= 0 ? '+' : ''}${pct(a - upRate)}%p | ${z.toFixed(2)} |`);
  }
  const best = rows.filter(r => !r.name.startsWith('늘 상승')).sort((x, y) => y.a - x.a)[0];
  console.log(`\n가장 높은 것: ${best.name} ${pct(best.a)}% (z ${best.z.toFixed(2)})`);
  console.log(best.z >= 1.96 ? '늘 상승을 5% 수준에서 이긴다.' : '늘 상승을 통계적으로 이기지 못한다 (|z| < 1.96).');
}

// ── 점검: 역전파가 수치 미분과 같은가 ─────────────────────────
function selftest() {
  const r = rng(7), F = 4, H = 3, C = 2, K = 3;
  const x = Array.from({ length: F }, () => gauss(r));
  const s = Array.from({ length: W }, () => Array.from({ length: F }, () => gauss(r)));
  const loss = (o, y) => -(y * Math.log(sig(o)) + (1 - y) * Math.log(1 - sig(o)));
  const check = (name, n, fwd, grad) => {
    const p = Float64Array.from({ length: n }, () => gauss(r) * 0.5), g = new Float64Array(n);
    grad(p, g);
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const q = Float64Array.from(p); q[i] += 1e-5; const up = loss(fwd(q), 1);
      q[i] -= 2e-5; const dn = loss(fwd(q), 1);
      worst = Math.max(worst, Math.abs((up - dn) / 2e-5 - g[i]));
    }
    const ok = worst < 1e-6;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} 기울기 최대 차 ${worst.toExponential(1)}`);
    return ok;
  };
  const a = check('MLP', F * H + H + H + 1, p => mlpForward(p, x, H).o, (p, g) => mlpGrad(p, x, 1, H, g));
  const b = check('1D-CNN', C * K * F + C + C + 1, p => cnnForward(p, s, C, K).o, (p, g) => cnnGrad(p, s, 1, C, K, g));
  // 시간 순서: 날짜 d 를 맞힐 때 d 이후 표본을 배우면 안 된다.
  const S = [0, 1, 2, 3].flatMap(d => [{ date: `d${d}`, y: d % 2 }, { date: `d${d}`, y: 1 }]);
  let leak = false;
  walkForward(S, tr => { const last = tr.map(q => q.date).sort().at(-1); return q => { if (last >= q.date) leak = true; return 1; }; }, { minTrainDays: 1 });
  console.log(`  ${leak ? 'FAIL' : 'PASS'}  walk-forward 가 시험 날짜와 그 뒤를 배우지 않는다`);
  if (!(a && b && !leak)) process.exit(1);
}

if (process.argv[1]?.endsWith('bakeoff.mjs')) process.argv.includes('--selftest') ? selftest() : run();
