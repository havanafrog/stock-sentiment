// KORU 깊이 보기 — 곡소리 지표가 다음 몇 시간 가격 방향을 알려 주나. 투자 조언이 아니라 지표 검증이다.
// 1차(backtest.mjs)의 수수료·봉·진입 규칙을 그대로 쓰고, 신호 종류·방향·시간대 무작위·MIN_N 만 늘렸다.
import { fileURLToPath } from 'node:url';
import { loadBars } from './prices.mjs';
import { loadComments, loadScorer, replay } from './replay.mjs';
import { FEE, LOOKBACK, MIN_BASE, MIN_N, KS, HS, SEED, RANDOM_RUNS, tradeReturn, rng } from './backtest.mjs';

export const MIN_NS = [5, 10, 20];
export const BOOT_RUNS = 1000;
export const SIGNALS = {                         // 값이 커질수록 "튄" 쪽
  wail: r => r.wailRatio,                        // 곡소리 비율 급등
  sent: r => (r.sent == null ? null : -r.sent),  // 감성 점수 급락
  n: r => r.n,                                   // 댓글 수 급증
};

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

/** 숏: 가격이 내린 만큼 번다. 수수료는 편도 FEE 를 양쪽에 물려 롱과 같은 비용(왕복 2·FEE). */
export const shortReturn = (entry, exit, fee = FEE) => -(exit / entry - 1) - 2 * fee;
export const RET = { long: tradeReturn, short: shortReturn };

/** 봉 i 가 신호를 낼 수 있는 상태인가: 댓글 minN 이상, 직전 24봉 중 유효 12봉 이상. */
function base(rows, i, minN, feat) {
  if (rows[i].n < minN) return null;
  const b = [];
  for (let j = Math.max(0, i - LOOKBACK); j < i; j++) if (rows[j].n >= minN) b.push(feat(rows[j]));
  return b.length < MIN_BASE ? null : { m: mean(b), s: std(b) };
}
export const eligible = (rows, i, minN) => base(rows, i, minN, SIGNALS.n) !== null;

/** 봉 i 까지의 값과 직전 봉들만 쓴다 — 미래 정보 없음. */
export function signalAt(rows, i, k, kind, minN) {
  const feat = SIGNALS[kind], b = base(rows, i, minN, feat);
  return !!b && b.s > 0 && feat(rows[i]) > b.m + k * b.s;
}

/** 신호 봉 i → 진입 e=i+1 시가, 청산 x=e+H-1 종가. 겹치는 신호는 버린다. 방향 둘 다의 수익을 같이 낸다. */
export function events(bars, rows, kind, k, H, minN, from, to = bars.length) {
  const out = []; let freeAt = 0;
  for (let i = from; i < to; i++) {
    const e = i + 1, x = e + H - 1;
    if (x >= bars.length || e < freeAt || !signalAt(rows, i, k, kind, minN)) continue;
    const o = bars[e].open, c = bars[x].close;
    out.push({ i, e, x, hour: new Date(bars[i].ms).getUTCHours(), long: tradeReturn(o, c), short: shortReturn(o, c) });
    freeAt = x + 1;
  }
  return out;
}

/** 평균의 부트스트랩 95% 구간 (거래를 복원추출). */
export function bootstrap(rets, runs = BOOT_RUNS, seed = SEED) {
  if (!rets.length) return null;
  const rnd = rng(seed), ms = [];
  for (let r = 0; r < runs; r++) {
    let s = 0;
    for (let j = 0; j < rets.length; j++) s += rets[Math.floor(rnd() * rets.length)];
    ms.push(s / rets.length);
  }
  ms.sort((a, b) => a - b);
  return { mean: mean(rets), lo: ms[Math.floor(0.025 * runs)], hi: ms[Math.min(runs - 1, Math.floor(0.975 * runs))] };
}

/** 시간대 맞춘 무작위 후보: 신호 봉과 같은 UTC 시(hour)의 봉만. hours = 신호 봉들의 시. */
export function hourCandidates(bars, rows, hours, H, minN, from, to = bars.length) {
  const want = new Set(hours), byHour = new Map();
  for (let i = from; i < to; i++) {
    const h = new Date(bars[i].ms).getUTCHours();
    if (i + H >= bars.length || !want.has(h) || !eligible(rows, i, minN)) continue;
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h).push(i);
  }
  return byHour;
}

/**
 * 신호와 같은 시·같은 횟수로 겹치지 않게 무작위 진입, runs 번. 방향별(long/short) 평균 수익의 분포.
 * 시마다 뽑을 수가 후보보다 많으면 null.
 */
export function hourMatchedRandom(bars, rows, evs, H, minN, from, runs = RANDOM_RUNS, seed = SEED) {
  if (!evs.length) return null;
  const need = new Map();
  for (const t of evs) need.set(t.hour, (need.get(t.hour) ?? 0) + 1);
  const cand = hourCandidates(bars, rows, [...need.keys()], H, minN, from);
  for (const [h, c] of need) if ((cand.get(h)?.length ?? 0) < c) return null;
  const rnd = rng(seed), out = { long: [], short: [] };
  for (let r = 0; r < runs; r++) {
    const picked = [];
    let ok = true;
    for (const [h, c] of need) {
      const pool = cand.get(h).slice(); let got = 0;
      while (got < c && pool.length) {
        const i = pool.splice(Math.floor(rnd() * pool.length), 1)[0], e = i + 1, x = e + H - 1;
        if (picked.some(t => e <= t.x && x >= t.e)) continue;
        picked.push({ e, x }); got++;
      }
      if (got < c) { ok = false; break; }
    }
    if (!ok) continue;
    const o = picked.map(t => [bars[t.e].open, bars[t.x].close]);
    out.long.push(mean(o.map(([a, b]) => tradeReturn(a, b))));
    out.short.push(mean(o.map(([a, b]) => shortReturn(a, b))));
  }
  if (out.long.length < runs / 2) return null;
  for (const d of ['long', 'short']) out[d].sort((a, b) => a - b);
  return out;
}
const quantileOf = (sorted, v) => sorted.filter(x => x < v).length / sorted.length;

const pct = (v, d = 2) => v == null ? '-' : (v * 100).toFixed(d) + '%';
const ci = b => b ? `${pct(b.mean)} [${pct(b.lo)}, ${pct(b.hi)}]` : '-';
const star = b => b && (b.lo > 0 || b.hi < 0) ? ' *' : '';   // 0 을 안 품은 구간

async function main() {
  const scorer = loadScorer();
  const comments = loadComments('KORU'), bars = await loadBars('KORU');
  const rows = replay(comments, bars, scorer);
  const first = rows.findIndex(r => r.n > 0);
  const name = { wail: '곡소리 비율 급등', sent: '감성 점수 급락', n: '댓글 수 급증' };
  console.log(`### 데이터\n\nKORU 댓글 ${comments.length}건, 봉 ${bars.length - first}개(첫 댓글 봉부터), 봉당 댓글≥10 ${rows.filter(r => r.n >= 10).length}개.\n`);

  console.log(`### 사건 연구와 시간대 맞춘 무작위 (MIN_N=${MIN_N})\n`);
  console.log('평균 수익 [부트스트랩 95% 구간]. `*` = 구간이 0 을 품지 않음. 분위 = 시간대 맞춘 무작위 평균 중 전략보다 낮은 비율(높을수록 무작위보다 낫다).\n');
  console.log('| 신호 | k | H | 거래 수 | 롱 평균 [95%] | 롱 분위 | 숏 평균 [95%] | 숏 분위 |\n|---|---|---|---|---|---|---|---|');
  let cells = 0, sig = 0;
  for (const kind of Object.keys(SIGNALS)) for (const k of KS) for (const H of HS) {
    const ev = events(bars, rows, kind, k, H, MIN_N, first);
    const bl = bootstrap(ev.map(t => t.long)), bs = bootstrap(ev.map(t => t.short));
    const rnd = hourMatchedRandom(bars, rows, ev, H, MIN_N, first);
    const q = d => rnd ? (quantileOf(rnd[d], mean(ev.map(t => t[d]))) * 100).toFixed(0) + '%' : '-';
    cells++; if (star(bl)) sig++; if (star(bs)) sig++;
    console.log(`| ${name[kind]} | ${k} | ${H} | ${ev.length} | ${ci(bl)}${star(bl)} | ${q('long')} | ${ci(bs)}${star(bs)} | ${q('short')} |`);
  }
  console.log(`\n구간이 0 을 품지 않은 칸: ${sig} / ${cells * 2} (롱·숏 합). 순전히 우연이어도 2.5%·양쪽 5% 정도는 나온다.\n`);

  console.log('### MIN_N 민감도 (롱 평균 / 숏 평균, 거래 수)\n');
  console.log('| 신호 | k | H | MIN_N=5 | MIN_N=10 | MIN_N=20 | 부호 뒤집힘 |\n|---|---|---|---|---|---|---|');
  for (const kind of Object.keys(SIGNALS)) for (const k of KS) for (const H of HS) {
    const rs = MIN_NS.map(m => events(bars, rows, kind, k, H, m, first));
    const cell = ev => ev.length ? `${pct(mean(ev.map(t => t.long)))} / ${pct(mean(ev.map(t => t.short)))} (${ev.length})` : '- (0)';
    const sg = d => rs.map(ev => ev.length ? Math.sign(mean(ev.map(t => t[d]))) : 0);
    const flip = d => { const s = sg(d).filter(Boolean); return s.some(x => x !== s[0]); };
    console.log(`| ${name[kind]} | ${k} | ${H} | ${rs.map(cell).join(' | ')} | ${flip('long') ? '롱 ' : ''}${flip('short') ? '숏' : ''}${flip('long') || flip('short') ? '' : '-'} |`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
