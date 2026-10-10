// 곡소리 비율이 튄 뒤 사면 나았나 — 규칙 백테스트. 투자 조언이 아니라 지표 검증이다.
import { fileURLToPath } from 'node:url';
import { loadBars } from './prices.mjs';
import { loadComments, loadScorer, replay } from './replay.mjs';

export const FEE = 0.001;        // 편도
export const LOOKBACK = 24;      // 직전 24봉
export const MIN_N = 10;         // 봉당 댓글이 이보다 적으면 비율이 흔들려 신호·기준선에서 뺀다
export const MIN_BASE = 12;      // 기준선에 쓸 유효 봉이 이보다 적으면 신호 없음
export const KS = [1, 1.5, 2];
export const HS = [1, 3, 6, 12];
export const RANDOM_RUNS = 1000;
export const MIN_TABLE = 100;     // 댓글≥MIN_N 봉이 이보다 적은 종목은 표를 만들지 않는다
export const SEED = 20260921;

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

/** 봉 i 직전 24봉(i 제외)의 곡소리 비율 평균·표준편차. 쓸 봉이 모자라면 null. */
function baseline(rows, i) {
  const base = [];
  for (let j = Math.max(0, i - LOOKBACK); j < i; j++) if (rows[j].n >= MIN_N) base.push(rows[j].wailRatio);
  return base.length < MIN_BASE ? null : { m: mean(base), s: std(base) };
}

/** 신호가 날 수 있는 봉인가 (무작위 진입 후보도 같은 조건). */
export const eligible = (rows, i) => rows[i].n >= MIN_N && baseline(rows, i) !== null;

/** 봉 i 의 신호. i 까지(포함)의 댓글과 직전 봉들만 쓴다 — 미래 정보 없음. */
export function signalAt(rows, i, k) {
  if (!eligible(rows, i)) return false;
  const { m, s } = baseline(rows, i);
  return s > 0 && rows[i].wailRatio > m + k * s;
}

/** 한 번의 왕복 수익률. 진입 시가·청산 종가에 편도 수수료. */
export const tradeReturn = (entry, exit, fee = FEE) => (exit * (1 - fee)) / (entry * (1 + fee)) - 1;

/**
 * 신호 봉 i → 진입 봉 e=i+1 시가, 청산 봉 x=e+H-1 종가(H 봉을 든다).
 * 앞 거래가 끝나기 전의 신호는 버린다. 신호 봉 범위는 [from, to).
 */
export function runTrades(bars, rows, k, H, from = 0, to = bars.length, fee = FEE) {
  const trades = []; let freeAt = 0;
  for (let i = from; i < to; i++) {
    const e = i + 1, x = e + H - 1;
    if (x >= bars.length || e < freeAt) continue;
    if (!signalAt(rows, i, k)) continue;
    trades.push({ e, x, ret: tradeReturn(bars[e].open, bars[x].close, fee) });
    freeAt = x + 1;
  }
  return trades;
}

/** 거래 순서대로 복리로 쌓은 자본의 최대 낙폭(음수 또는 0). */
export function maxDrawdown(rets) {
  let eq = 1, peak = 1, dd = 0;
  for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); }
  return dd;
}

export function summarize(trades) {
  const r = trades.map(t => t.ret);
  return {
    n: r.length,
    avg: r.length ? mean(r) : null,
    win: r.length ? r.filter(x => x > 0).length / r.length : null,
    mdd: r.length ? maxDrawdown(r) : null,
  };
}

/** 신호 구간 [from, to) 을 그냥 들고 있기: from+1 시가 → 마지막 봉 종가, 수수료 왕복. */
export function buyHold(bars, from, to, fee = FEE) {
  const e = from + 1, x = Math.min(to, bars.length) - 1;
  return x > e ? tradeReturn(bars[e].open, bars[x].close, fee) : null;
}

export function rng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 같은 횟수(count)만큼 겹치지 않게 무작위 진입, runs 번. 진입 후보는 신호가 날 수 있었던
 * 봉(eligible)이라 비교가 공정하다. 매번의 평균 수익을 모아 분포를 낸다.
 */
export function randomBaseline(bars, rows, H, count, from, to, runs = RANDOM_RUNS, seed = SEED, fee = FEE) {
  const cand = [];
  for (let i = from; i < to; i++) if (i + H < bars.length && eligible(rows, i)) cand.push(i);
  if (!count || cand.length < count) return null;
  const rnd = rng(seed), avgs = [];
  for (let r = 0; r < runs; r++) {
    const picked = [], pool = cand.slice();
    while (picked.length < count && pool.length) {
      const i = pool.splice(Math.floor(rnd() * pool.length), 1)[0], e = i + 1, x = e + H - 1;
      if (picked.some(t => e <= t.x && x >= t.e)) continue;
      picked.push({ e, x, ret: tradeReturn(bars[e].open, bars[x].close, fee) });
    }
    if (picked.length === count) avgs.push(mean(picked.map(t => t.ret)));
  }
  if (avgs.length < runs / 2) return null;
  avgs.sort((a, b) => a - b);
  return { mean: mean(avgs), p5: avgs[Math.floor(0.05 * avgs.length)], p95: avgs[Math.floor(0.95 * avgs.length)], sorted: avgs };
}

/** 전략 평균이 무작위 분포의 몇 분위인가 (0~1, 높을수록 무작위보다 낫다). */
export const quantileOf = (sorted, v) => sorted.filter(x => x < v).length / sorted.length;

/** 앞 절반에서 (k,H) 고르고(평균 수익 최대, 거래 3건 이상) 뒤 절반에서만 잰다. */
export function walkForward(bars, rows, first, last) {
  const mid = first + Math.floor((last - first) / 2);
  let best = null;
  for (const k of KS) for (const H of HS) {
    const s = summarize(runTrades(bars, rows, k, H, first, mid));
    if (s.n >= 3 && (!best || s.avg > best.avg)) best = { k, H, ...s };
  }
  if (!best) return { mid, pick: null };
  const test = summarize(runTrades(bars, rows, best.k, best.H, mid, last));
  return { mid, pick: best, test, bh: buyHold(bars, mid, last), rnd: randomBaseline(bars, rows, best.H, test.n, mid, last) };
}

const pct = (v, d = 2) => v == null ? '-' : (v * 100).toFixed(d) + '%';
const qpct = (rnd, s) => rnd && s.n ? (quantileOf(rnd.sorted, s.avg) * 100).toFixed(0) + '%' : '-';

async function main() {
  const scorer = loadScorer();
  const args = process.argv.slice(2);
  const tickers = args.length ? args : ['SOXL', 'SNDK', 'KORU', 'MU', 'SNXX', 'MUU', 'MRNA', 'TSLA', 'DRAM'];
  const full = [], wf = [], meta = [];
  for (const t of tickers) {
    const comments = loadComments(t);
    if (comments.length < 300) { meta.push(`| ${t} | ${comments.length} | - | - | 건너뜀(댓글 부족) |`); continue; }
    const bars = await loadBars(t);
    const rows = replay(comments, bars, scorer);
    const first = rows.findIndex(r => r.n > 0), last = bars.length;
    if (first < 0) { meta.push(`| ${t} | ${comments.length} | 0 | 0 | 봉과 겹치는 댓글 없음 |`); continue; }
    const good = rows.filter(r => r.n >= MIN_N).length;
    meta.push(`| ${t} | ${comments.length} | ${last - first} | ${good} | ${new Date(bars[first].ms).toISOString().slice(0, 10)} ~ ${new Date(bars[last - 1].ms).toISOString().slice(0, 10)} |`);
    if (good < MIN_TABLE) { meta[meta.length - 1] = meta.at(-1).replace(/ \|$/,' — 표본 부족, 표 생략 |'); continue; }
    for (const k of KS) for (const H of HS) {
      const s = summarize(runTrades(bars, rows, k, H, first, last));
      const rnd = randomBaseline(bars, rows, H, s.n, first, last);
      full.push(`| ${t} | ${k} | ${H} | ${s.n} | ${pct(s.avg)} | ${pct(s.win, 0)} | ${pct(s.mdd)} | ${rnd ? pct(rnd.mean) : '-'} | ${qpct(rnd, s)} | ${pct(buyHold(bars, first, last))} |`);
    }
    const w = walkForward(bars, rows, first, last);
    if (!w.pick) { wf.push(`| ${t} | - | - | - | 0 | - | - | - | - | ${pct(buyHold(bars, w.mid, last))} |`); continue; }
    wf.push(`| ${t} | ${w.pick.k} | ${w.pick.H} | ${pct(w.pick.avg)} | ${w.test.n} | ${pct(w.test.avg)} | ${pct(w.test.win, 0)} | ${pct(w.test.mdd)} | ${w.rnd ? pct(w.rnd.mean) : '-'} / ${qpct(w.rnd, w.test)} | ${pct(w.bh)} |`);
  }
  console.log('## 데이터\n');
  console.log('| 종목 | 댓글 | 봉 수 | 댓글≥' + MIN_N + ' 봉 | 봉 기간(UTC) |\n|---|---|---|---|---|');
  console.log(meta.join('\n'));
  console.log('\n## 전체 기간 (k, H 전부)\n');
  console.log('| 종목 | k | H | 거래 수 | 평균 수익 | 승률 | 최대 낙폭 | 무작위 평균 | 무작위 대비 분위 | 들고 있기 |\n|---|---|---|---|---|---|---|---|---|---|');
  console.log(full.join('\n'));
  console.log('\n## 걷기 검증 (앞 절반에서 고른 k,H → 뒤 절반 성적)\n');
  console.log('| 종목 | k | H | 앞 절반 평균 | 뒤 거래 수 | 뒤 평균 수익 | 뒤 승률 | 뒤 최대 낙폭 | 무작위 평균 / 분위 | 뒤 들고 있기 |\n|---|---|---|---|---|---|---|---|---|---|');
  console.log(wf.join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
