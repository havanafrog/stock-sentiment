// 글자 n-gram 나이브 베이즈. 의존성 없이 순수 JS 로 돌린다.
//
// 왜 사전이 아니라 이건가:
//   사전은 낱말 하나가 곧 방향이다. "안되" 가 부정이면 어디 나와도 부정이다.
//   그런데 글이 짧다(중앙값 10글자). 짧은 글에서는 조합이 방향을 바꾼다 —
//   "안되네" 와 "안되겠나" 는 다른 말이다. n-gram 은 그 조합을 통째로 센다.
//
// 왜 나이브 베이즈인가:
//   40줄이면 끝나고, 모델이 그냥 숫자표라 1GB 서버에 얹힌다.
//   글이 짧아 특징이 15개 안팎이라 독립 가정이 덜 아프다.
//
// 학습은 docs/labels-4000.json + 직접 찍은 것만 쓴다. 홀드아웃은 안 쓴다 —
// 사전과 같은 자로 재야 어느 쪽이 나은지 알 수 있다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const W = {};
new Function('window', readFileSync('lexicon.js', 'utf8'))(W);

const CLASSES = ['P', 'N', 'X'];

// ── 특징 뽑기 ────────────────────────────────────────────────
// 사전과 같은 normalize 를 쓴다. 필터 회피 글자(시1발)를 같은 방식으로 되살려야
// 두 채점기를 같은 조건에서 비교할 수 있다.
export function feats(raw, { nMin = 1, nMax = 3 } = {}) {
  const t = W.normalize(String(raw || '')).toLowerCase();
  if (!t) return [];
  // 앞뒤에 경계 표시를 붙인다. 글 첫머리의 "왜" 와 가운데의 "왜" 는 다르다.
  const s = String.fromCharCode(1) + t + String.fromCharCode(2);
  const out = [];
  for (let n = nMin; n <= nMax; n++)
    for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  return out;
}

// ── 학습 ─────────────────────────────────────────────────────
// binarize: 한 글에서 같은 n-gram 이 여러 번 나와도 1번만 센다.
//   "무섭무섭무섭" 이 "무섭" 하나보다 3배 무서운 건 아니다. 짧은 글에서는
//   반복이 강조지 증거가 아니다.
export function train(rows, { nMin = 1, nMax = 3, alpha = 0.2, binarize = true, minDf = 2 } = {}) {
  const df = new Map();                       // n-gram → 나온 글 수
  const docs = rows.map(r => {
    const f = binarize ? [...new Set(feats(r.text, { nMin, nMax }))] : feats(r.text, { nMin, nMax });
    for (const g of binarize ? f : new Set(f)) df.set(g, (df.get(g) || 0) + 1);
    return { y: r.y, f };
  });

  // 한두 글에만 나온 n-gram 은 외우기지 배우기가 아니다. 모델 크기도 이걸로 줄인다.
  const vocab = new Map();
  for (const [g, c] of df) if (c >= minDf) vocab.set(g, vocab.size);

  const V = vocab.size;
  const cnt = CLASSES.map(() => new Float64Array(V));
  const tot = new Float64Array(CLASSES.length);
  const prior = new Float64Array(CLASSES.length);

  for (const d of docs) {
    const ci = CLASSES.indexOf(d.y);
    if (ci < 0) continue;
    prior[ci]++;
    for (const g of d.f) {
      const j = vocab.get(g);
      if (j === undefined) continue;
      cnt[ci][j]++; tot[ci]++;
    }
  }

  // 로그확률로 미리 접어 둔다. 채점할 때는 더하기만 하면 된다.
  const w = CLASSES.map((_, ci) => {
    const denom = Math.log(tot[ci] + alpha * V);
    const a = new Float32Array(V);
    for (let j = 0; j < V; j++) a[j] = Math.log(cnt[ci][j] + alpha) - denom;
    return a;
  });
  const n = rows.length;
  const lp = CLASSES.map((_, ci) => Math.log((prior[ci] + 1) / (n + CLASSES.length)));
  // 못 본 n-gram 에 줄 값. 없으면 그냥 건너뛰지만, 클래스마다 분모가 달라
  // 건너뛰기만 하면 어휘가 큰 클래스가 유리해진다.
  const unk = CLASSES.map((_, ci) => Math.log(alpha) - Math.log(tot[ci] + alpha * V));
  return { vocab, w, lp, unk, nMin, nMax, binarize };
}

// ── 채점 ─────────────────────────────────────────────────────
export function predict(m, raw) {
  const f = m.binarize
    ? [...new Set(feats(raw, m))]
    : feats(raw, m);
  const s = m.lp.slice();
  for (const g of f) {
    const j = m.vocab.get(g);
    for (let ci = 0; ci < CLASSES.length; ci++) s[ci] += j === undefined ? m.unk[ci] : m.w[ci][j];
  }
  let best = 0;
  for (let ci = 1; ci < CLASSES.length; ci++) if (s[ci] > s[best]) best = ci;
  // softmax 로 확률까지 낸다 — 나중에 임계값을 만질 때 필요하다.
  const mx = Math.max(...s);
  const ex = s.map(v => Math.exp(v - mx));
  const z = ex.reduce((a, b) => a + b, 0);
  return { y: CLASSES[best], p: ex.map(v => v / z) };
}

// ── 채점표 ───────────────────────────────────────────────────
export function report(rows, pred, tag) {
  const cm = {};
  for (const r of rows) { const k = r.y + '/' + pred(r.text); cm[k] = (cm[k] || 0) + 1; }
  const n = (a, b) => cm[a + '/' + b] || 0;
  const out = [`── ${tag} (${rows.length.toLocaleString()}건) ──`, '        예측 P   예측 N   예측 X'];
  for (const y of CLASSES)
    out.push(`실제 ${y}  ${String(n(y,'P')).padStart(6)}  ${String(n(y,'N')).padStart(6)}  ${String(n(y,'X')).padStart(6)}`);
  const f1 = c => {
    const tp = n(c, c);
    const fp = CLASSES.filter(y => y !== c).reduce((s, y) => s + n(y, c), 0);
    const fn = CLASSES.filter(p => p !== c).reduce((s, p) => s + n(c, p), 0);
    const pr = tp / (tp + fp || 1), rc = tp / (tp + fn || 1);
    return { pr, rc, f1: 2 * pr * rc / (pr + rc || 1) };
  };
  const m = {};
  for (const c of ['P', 'N']) {
    m[c] = f1(c);
    out.push(`  ${c}  정밀도 ${(m[c].pr*100).toFixed(1)}%  재현율 ${(m[c].rc*100).toFixed(1)}%  F1 ${(m[c].f1*100).toFixed(1)}%`);
  }
  const acc = CLASSES.reduce((s, c) => s + n(c, c), 0) / rows.length;
  out.push(`  전체 정확도 ${(acc*100).toFixed(1)}%`);
  return { text: out.join('\n'), acc, P: m.P, N: m.N };
}

// ── 데이터 ───────────────────────────────────────────────────
export function datasets() {
  const tuned = new Set(JSON.parse(readFileSync('docs/labels-4000.json', 'utf8')).map(r => r.id));
  const all = JSON.parse(readFileSync('docs/labels-holdout-12000.json', 'utf8'));
  const train4k = JSON.parse(readFileSync('docs/labels-4000.json', 'utf8'));
  const held = all.filter(r => !tuned.has(r.id));

  const read150 = existsSync('docs/labels-read-150.json')
    ? JSON.parse(readFileSync('docs/labels-read-150.json', 'utf8')) : [];

  const f = process.env.STOCK_DATA_DIR ? join(process.env.STOCK_DATA_DIR, 'labels.jsonl') : 'data/labels.jsonl';
  const by = new Map();
  if (existsSync(f)) for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r.y && r.text) by.set(r.id, r); else by.delete(r.id); } catch { /* 잘린 줄 */ }
  }
  const mine = [...by.values()];

  // 홀드아웃에 있는 글이 학습에 섞이면 잰 숫자가 거짓말이 된다.
  const heldIds = new Set(held.map(r => r.id));
  const extra = [...read150, ...mine].filter(r => r.y && r.text && !heldIds.has(r.id));

  return { train4k, held, extra, read150, mine };
}

// ── 교차검증 (학습셋 안에서만) ───────────────────────────────
// 설정을 홀드아웃으로 고르면 홀드아웃이 더는 홀드아웃이 아니다.
export function cv(rows, opt, k = 5) {
  const acc = [];
  for (let fold = 0; fold < k; fold++) {
    const tr = rows.filter((_, i) => i % k !== fold);
    const te = rows.filter((_, i) => i % k === fold);
    const m = train(tr, opt);
    let hit = 0;
    for (const r of te) if (predict(m, r.text).y === r.y) hit++;
    acc.push(hit / te.length);
  }
  return acc.reduce((a, b) => a + b, 0) / k;
}

// ── 저장 ─────────────────────────────────────────────────────
// 가중치를 1000배 정수로 접는다. 로그확률 소수 3자리면 충분하다 —
// 그 아래 자리는 순서를 못 바꾼다. 파일이 3분의 1로 준다.
export function serialize(m) {
  return {
    // 구분자는 U+0000. n-gram 안에 경계표시 U+0001·U+0002 가 들어 있어 겹치면 안 된다.
    v: [...m.vocab.keys()].join(String.fromCharCode(0)),
    w: m.w.map(a => Array.from(a, x => Math.round(x * 1000))),
    lp: m.lp.map(x => Math.round(x * 1000)),
    unk: m.unk.map(x => Math.round(x * 1000)),
    nMin: m.nMin, nMax: m.nMax, binarize: m.binarize,
  };
}

// ── CLI ──────────────────────────────────────────────────────
//   node tools/train-nb.mjs          자로 잰다. 학습 4,170 · 홀드아웃 11,643
//   node tools/train-nb.mjs --full   가진 라벨 전부로 배워 model.json 을 쓴다
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const OPT = { nMin: 1, nMax: 2, alpha: 1, binarize: true, minDf: 1 };
  const { train4k, held, extra } = datasets();
  const ruler = [...train4k, ...extra];

  if (process.argv.includes('--full')) {
    // 재는 건 위의 4,170건짜리로 하고, 내보내는 건 가진 걸 다 쓴 모델이다.
    // 데이터가 3.8배라 실제 성능은 잰 숫자보다 나을 것이다 — 다만 잰 건 아니다.
    const all = [...ruler, ...held];
    const m = train(all, OPT);
    const out = process.argv[process.argv.indexOf('--full') + 1] || 'model.json';
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, JSON.stringify(serialize(m)));
    console.log(`${out} — 라벨 ${all.length.toLocaleString()}건 · 어휘 ${m.vocab.size.toLocaleString()}개`);
  } else {
    const m = train(ruler, OPT);
    const W = {};
    new Function('window', readFileSync('lexicon.js', 'utf8'))(W);
    const lex = t => { const s = W.scoreWith(t, W.LEX_DEFAULT); return s > 0 ? 'P' : s < 0 ? 'N' : 'X'; };
    console.log(`학습 ${ruler.length.toLocaleString()} · 홀드아웃 ${held.length.toLocaleString()} · 어휘 ${m.vocab.size.toLocaleString()}\n`);
    console.log(report(held, t => predict(m, t).y, '분류기').text, '\n');
    console.log(report(held, lex, '사전').text);
  }
}
