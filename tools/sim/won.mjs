// 9/1 에 10만 원 — 신호 3 × k 3 × H 4 × 방식(피하기·피하고 숏·신호 뒤에만 사기) × 4종목. 결과: docs/sim-won.html
// STOCK_DATA_DIR=data node tools/sim/won.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const { resolveStock, fetchBars } = await import("../../toss.mjs");
const { loadBars } = await import("./prices.mjs");
const { loadComments, loadScorer, replay } = await import("./replay.mjs");
const { events } = await import("./koru.mjs");
// 일봉도 60분봉처럼 cache/ 에 한 번만 받는다 (9/1 시가를 고정하려고).
async function daily(code, tk) {
  const f = new URL(`./cache/${tk}.day1.json`, import.meta.url);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const d = (await fetchBars(code, 'day:1', 60)).filter(b => b.dt.slice(0, 10) <= '2026-10-09');
  writeFileSync(f, JSON.stringify(d));
  return d;
}
const FEE = 0.001, START = 100000, KS = [1, 1.5, 2], HS = [1, 3, 6, 12], KINDS = ['wail', 'sent', 'n'];
const NAME = { wail: '곡소리', sent: '감성급락', n: '댓글급증' };
const MODES = ['avoid', 'short', 'only'];
const scorer = loadScorer();
// 모드별 최종 금액. p0 = 시작 가격(시가), p1 = 끝 가격(종가). 수수료 편도 FEE.
function run(bars, ev, p0, p1, mode) {
  if (mode === 'only') { let v = START; for (const t of ev) v *= 1 + t.long; return v; }
  let sh = START * (1 - FEE) / p0;
  for (const t of ev) {
    const o = bars[t.e].open, c = bars[t.x].close;
    let cash = sh * o * (1 - FEE);
    if (mode === 'short') cash *= 1 + t.short;
    sh = cash * (1 - FEE) / c;
  }
  return sh * p1 * (1 - FEE);
}
const out = {};
for (const tk of ['SOXL', 'SNDK', 'KORU', 'MU']) {
  const { code } = await resolveStock(tk);
  const d0 = (await daily(code, tk)).find(b => b.dt.slice(0, 10) >= '2026-09-01');
  const bars = await loadBars(tk), rows = replay(loadComments(tk), bars, scorer);
  const first = rows.findIndex(r => r.n > 0), mid = first + Math.floor((bars.length - first) / 2), L = bars.length;
  const hold = run(bars, [], d0.open, bars.at(-1).close, 'avoid');
  const cells = [];
  for (const kind of KINDS) for (const k of KS) for (const H of HS) {
    const ev = events(bars, rows, kind, k, H, 10, first);
    const a = events(bars, rows, kind, k, H, 10, first, mid).filter(t => t.x < mid);
    const b = events(bars, rows, kind, k, H, 10, mid);
    for (const mode of MODES) cells.push({ kind, k, H, mode, n: ev.length,
      full: run(bars, ev, d0.open, bars.at(-1).close, mode),
      // 반쪽: 그 구간 시가에 사서 종가까지, 같은 규칙
      A: run(bars, a, bars[first].open, bars[mid - 1].close, mode) / run(bars, [], bars[first].open, bars[mid - 1].close, 'avoid'),
      B: run(bars, b, bars[mid].open, bars.at(-1).close, mode) / run(bars, [], bars[mid].open, bars.at(-1).close, 'avoid') });
  }
  out[tk] = { hold, cells, p0: d0.open, p1: bars.at(-1).close };
}
const won = v => Math.round(v).toLocaleString('ko-KR');
const lab = c => `${NAME[c.kind]} k${c.k} H${c.H} ${c.mode}`;
for (const [tk, o] of Object.entries(out)) {
  const top = [...o.cells].sort((x, y) => y.full - x.full);
  const pick = [...o.cells].filter(c => c.mode !== 'only').sort((x, y) => y.A - x.A)[0];
  console.log(`\n${tk} ${o.p0}->${o.p1} 들고있기 ${won(o.hold)}`);
  for (const c of top.slice(0, 3)) console.log(`  best ${lab(c)} n${c.n} ${won(c.full)}`);
  const bestOnly = top.filter(c => c.mode === 'only')[0];
  console.log(`  신호뒤사기 최고 ${lab(bestOnly)} ${won(bestOnly.full)}`);
  console.log(`  걷기: 앞에서 고른 ${lab(pick)} 앞 x${pick.A.toFixed(3)} 뒤 x${pick.B.toFixed(3)}`);
}
// 4종목 공통: 같은 설정을 다 썼을 때 들고있기 대비 배수의 기하평균, 최소
const keys = out.KORU.cells.map((_, i) => i);
const common = keys.map(i => { const r = Object.values(out).map(o => o.cells[i].full / o.hold);
  return { c: out.KORU.cells[i], g: Math.exp(r.reduce((s, x) => s + Math.log(x), 0) / r.length), min: Math.min(...r), r }; })
  .sort((x, y) => y.g - x.g);
console.log('\n공통 설정 (들고있기 대비 배수, 종목 SOXL SNDK KORU MU)');
for (const x of common.slice(0, 8)) console.log(`  ${lab(x.c)} 평균 x${x.g.toFixed(3)} 최소 x${x.min.toFixed(3)} [${x.r.map(v => v.toFixed(2)).join(' ')}]`);
for (const m of MODES) { const w = common.filter(x => x.c.mode === m).filter(x => x.min > 1).length; console.log(`  ${m}: 4종목 모두 들고있기보다 나은 설정 ${w}/36`); }
// 공통 걷기: 앞 절반 4종목 기하평균으로 고르고 뒤 절반 확인
const gm = a => Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / a.length);
const cw = keys.filter(i => out.KORU.cells[i].mode !== 'only').map(i => ({ c: out.KORU.cells[i], A: gm(Object.values(out).map(o => o.cells[i].A)), B: Object.values(out).map(o => o.cells[i].B) })).sort((x, y) => y.A - x.A);
console.log('\n공통 걷기 (앞 절반 상위 3 → 뒤 절반 종목별)');
for (const x of cw.slice(0, 3)) console.log(`  ${lab(x.c)} 앞 x${x.A.toFixed(3)} 뒤 [${x.B.map(v => v.toFixed(3)).join(' ')}]`);
console.log('\n피하기만(숏 없이) 공통 상위');
for (const x of common.filter(x => x.c.mode === 'avoid').slice(0, 4)) console.log(`  ${lab(x.c)} 평균 x${x.g.toFixed(3)} 최소 x${x.min.toFixed(3)}`);
for (const [kind, k, H] of [['sent', 1, 3], ['sent', 1, 1]]) {
  const i = out.KORU.cells.findIndex(c => c.kind === kind && c.k === k && c.H === H && c.mode === 'avoid');
  console.log(`\n${NAME[kind]} k${k} H${H} 원화: 종목 / 들고있기 / 피하기 / 피하고숏 / 거래`);
  for (const [tk, o] of Object.entries(out)) console.log(`  ${tk} ${won(o.hold)} ${won(o.cells[i].full)} ${won(o.cells[i + 1].full)} ${o.cells[i].n}`);
}
