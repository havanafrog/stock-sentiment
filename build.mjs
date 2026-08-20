/**
 * data/*.posts.json 을 채점하고 일봉과 합쳐 data.js 를 만든다.
 *
 *   node build.mjs               # 최근 30일
 *   node build.mjs --days 90
 *   node build.mjs --selftest    # 네트워크 없이 날짜 변환·채점·집계 점검
 *
 * 네트워크는 일봉뿐이라 몇 초면 끝난다. lexicon.js 를 고친 뒤 여기만 다시 돌리면
 * 게시글을 다시 받지 않고 점수만 갱신된다.
 *
 * 출력이 .json 이 아니라 .js 인 이유: index.html 을 더블클릭해 열면 file:// 스킴이라
 * fetch()로 로컬 JSON을 못 읽는다(CORS). <script src> 는 file:// 에서도 동작한다.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { DATA_DIR, BASELINE_FILE, ensureDataDir } from './paths.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStock, fetchCandles, fetchRate, et } from './toss.mjs';
import { TICKERS } from './tickers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = ensureDataDir();

const argv = process.argv.slice(2);
const dashDays = argv.indexOf('--days');
const DAYS = Number(dashDays >= 0 ? argv[dashDays + 1] : 30);

// ── 사전·채점기는 lexicon.js 한 곳에서만 가져온다 ─────────────
// 브라우저용 파일이라 window 에 붙는다. 빈 객체를 window 인 척 넘겨 받아낸다.
// 여기서 사전을 다시 정의하면 대시보드 점수와 갈린다.
function loadLexicon() {
  const src = readFileSync(join(HERE, 'lexicon.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  if (!w.LEX_DEFAULT || !w.scoreWith) throw new Error('lexicon.js 형식이 예상과 다릅니다.');
  return w;
}

/**
 * 게시글을 거래일에 붙인다.
 *
 * 게시글의 미 동부 날짜가 거래일이면 그 날, 아니면(주말·휴장) 다음 거래일로 넘긴다.
 * 주말에 쌓인 이야기는 월요일 세션을 향한 것이므로 버리지 않고 월요일에 얹는다.
 *
 * intraday 는 정규장(09:30~16:00 ET) 중에 쓰인 글만 따로 센 것이다. 장 마감 뒤 글은
 * 그날 종가에 영향을 줄 수 없으므로, 이 둘을 갈라야 "예측인가 반응인가"를 물을 수 있다.
 */
export function aggregate(posts, tradingDates, score, hasFear = () => false) {
  const sorted = [...tradingDates].sort();
  const isTrading = new Set(sorted);
  const bucketOf = new Map();        // 달력 날짜 → 붙일 거래일
  const assign = date => {
    if (bucketOf.has(date)) return bucketOf.get(date);
    const hit = sorted.find(d => d >= date) ?? null;
    bucketOf.set(date, hit);
    return hit;
  };

  const acc = {};
  for (const p of posts) {
    const { date, intraday } = et(p.at);
    const day = assign(date);
    if (day === null) continue;                    // 마지막 거래일 이후 글 — 아직 세션이 없다
    const a = (acc[day] ||= { all: [], intra: [], fear: 0, fearIntra: 0 });
    const s = score(p.text);
    const f = hasFear(p.text);
    a.all.push(s);
    if (f) a.fear++;
    // et() 는 시계만 본다. 토요일 11시도 09:30~16:00 안이므로, 그날이 실제 거래일인지
    // 여기서 한 번 더 걸러야 "장중"이 진짜 장중이 된다.
    if (intraday && isTrading.has(date)) { a.intra.push(s); if (f) a.fearIntra++; }
  }

  const mean = xs => (xs.length ? +(xs.reduce((x, y) => x + y, 0) / xs.length).toFixed(4) : null);
  const ratio = (k, n) => (n ? +(k / n).toFixed(5) : null);
  const out = {};
  for (const [date, a] of Object.entries(acc)) {
    out[date] = {
      posts: a.all.length,
      sentiment: mean(a.all),
      postsIntra: a.intra.length,
      sentimentIntra: mean(a.intra),
      // 공포는 강도가 아니라 비율이다 — 공포어가 든 글이 그날 글 중 몇 %인가
      fear: ratio(a.fear, a.all.length),
      fearIntra: ratio(a.fearIntra, a.intra.length),
    };
  }
  return out;
}

// ── 공포 기준선 ──────────────────────────────────────────────
// "공포가 높다"는 절대값으로 말할 수 없다. 실측 결과 종목별 평소 비율이
// SNDK 3.7% ~ MUU 7.1% 로 2배 차이나고, 같은 종목도 미 동부 시간대별로 2배 차이난다
// (MU 09시 3.9% ↔ 03시 7.2%). 그래서 (종목 × ET 시각) 별로 평소 분포를 만들어 두고
// 실시간 값을 z-score 로 잰다.
//
// 표본 단위는 "그 날 그 시간대의 비율" 하나다. 30일이면 시간대마다 최대 30개.
const MIN_BUCKET = 20;   // 그 시간에 글이 이만큼은 있어야 비율이 의미 있다
const MIN_DAYS = 5;      // 시간대별 통계를 내려면 이만큼의 날이 필요하다

function stat(xs) {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  // 표본 표준편차(n-1). n=1 이면 0 이 되는데, 아래에서 sd 가 0 인 칸은 안 쓴다.
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  return { mean: +m.toFixed(5), sd: +sd.toFixed(5), n };
}

export function fearBaseline(posts, hasFear) {
  const cell = {};                                  // "날짜|ET시" → { n, f }
  for (const p of posts) {
    const e = et(p.at);
    const k = `${e.date}|${Math.floor(e.min / 60)}`;
    const c = (cell[k] ||= { n: 0, f: 0 });
    c.n++;
    if (hasFear(p.text)) c.f++;
  }

  const byHour = {};
  for (const [k, c] of Object.entries(cell)) {
    if (c.n < MIN_BUCKET) continue;                 // 표본 적은 버킷은 비율이 튄다
    (byHour[+k.split('|')[1]] ||= []).push(c.f / c.n);
  }

  const hourly = {};
  for (const [h, xs] of Object.entries(byHour)) if (xs.length >= MIN_DAYS) hourly[h] = stat(xs);
  const all = Object.values(byHour).flat();
  return { hourly, overall: all.length ? stat(all) : null };
}

/**
 * 일별 공포지수용 기준선.
 *
 * 실시간 지수는 (종목 × ET 시각) 기준선을 쓰지만, 일별 차트의 한 점은 하루치를
 * 통째로 합친 값이라 시간대 구성이 이미 섞여 끝난 뒤다. 그래서 차트가 실제로
 * 그리는 그 열(fear / fearIntra)의 분포를 그대로 기준선으로 삼는다.
 *
 * 주의: 기준선을 이 창(--days) 안에서 뽑으므로 지수는 창 안의 상대값이다.
 * 평균이 구조적으로 50 근처가 된다. 창이 길수록 안정된다.
 */
export function dailyBaseline(days) {
  const pick = (ratio, count) => {
    const xs = days.filter(d => d[count] >= MIN_BUCKET && d[ratio] !== null).map(d => d[ratio]);
    return xs.length >= MIN_DAYS ? stat(xs) : null;
  };
  return { all: pick('fear', 'posts'), intra: pick('fearIntra', 'postsIntra') };
}

// ── 계수 기준선 ─────────────────────────────────────────────
// 짧은 구간에서는 비율을 못 쓴다. 1분 버킷의 글 수 중앙값이 2건이라
// 비율이 0% / 50% / 100% 셋뿐이고, 표본 문턱(20건)을 걸면 97%가 빈칸이 된다.
// 그래서 "공포 글이 몇 개 왔나"를 재고, 그 종목·그 ET 시각의 평소와 견준다.
//
// 두 가지를 지킨다:
//   1. 글이 하나도 없는 버킷도 표본이다. 빼면 평균이 2.6배 부풀려진다
//      (SNDK ET 10시: 포함 0.60 ± 1.00 · 제외 1.59 ± 1.03).
//   2. 주말은 뺀다. 넣으면 평일 같은 시각이 늘 높아 보인다 (0.60 → 0.45).
export const COUNT_UNITS = { 'min:1': 60_000, 'min:10': 600_000, 'min:60': 3_600_000 };

/** ms → { hour, weekend } — 시간 버킷마다 한 번만 Intl 을 부른다(분마다 부르면 느리다) */
function hourMap(from, to) {
  const F = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  const m = new Map();
  for (let h = Math.floor(from / 3_600_000); h <= Math.floor(to / 3_600_000); h++) {
    const parts = F.formatToParts(new Date(h * 3_600_000));
    const wd = parts.find(x => x.type === 'weekday').value;
    m.set(h, { hour: +parts.find(x => x.type === 'hour').value,
               weekend: wd === 'Sat' || wd === 'Sun' });
  }
  return m;
}

/**
 * 봉 단위별 · ET 시각별 "그 구간에 오는 공포 글 수" 분포.
 * 일봉은 시각 축이 없으므로 거래일 하나를 표본으로 삼는다.
 */
export function countBaseline(posts, isHit) {
  if (!posts.length) return null;
  const stamps = posts.map(p => ({ ms: Date.parse(p.at), f: isHit(p.text) }))
    .filter(p => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms);
  if (!stamps.length) return null;

  const from = stamps[0].ms, to = stamps[stamps.length - 1].ms;
  const HM = hourMap(from, to);
  const out = {};

  for (const [unit, step] of Object.entries(COUNT_UNITS)) {
    const fear = new Map();                      // 버킷 → 공포 글 수
    for (const p of stamps) if (p.f) {
      const k = Math.floor(p.ms / step);
      fear.set(k, (fear.get(k) ?? 0) + 1);
    }
    const byHour = {};
    for (let k = Math.floor(from / step); k <= Math.floor(to / step); k++) {
      const h = HM.get(Math.floor((k * step) / 3_600_000));
      if (!h || h.weekend) continue;
      (byHour[h.hour] ??= []).push(fear.get(k) ?? 0);   // 빈 버킷도 0 으로 센다
    }
    const hourly = {};
    for (const [h, xs] of Object.entries(byHour)) if (xs.length >= MIN_DAYS) hourly[h] = stat(xs);
    out[unit] = { hourly };
  }

  // 일봉 — 거래일 하나가 표본 하나. 시각 축이 없다.
  const perDay = new Map();
  for (const p of stamps) {
    const d = et(new Date(p.ms).toISOString()).date;
    perDay.set(d, (perDay.get(d) ?? 0) + (p.f ? 1 : 0));
  }
  const days = [...perDay.values()];
  out['day:1'] = { overall: days.length >= MIN_DAYS ? stat(days) : null };
  return out;
}

// ── 자체 점검 (네트워크 없음) ────────────────────────────────
function selftest() {
  const { LEX_DEFAULT, scoreWith, hasFear, isWail, fearIndex, fearIntensity, FEAR_ALERT } = loadLexicon();
  const s = t => scoreWith(t, LEX_DEFAULT);
  let n = 0;
  const ok = (label, cond, extra = '') => {
    if (!cond) throw new Error(`${label}  ${extra}`);
    n++; console.log(`  PASS  ${label}`);
  };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const eq = (label, got, want) => ok(label, near(got, want), `${got} ≠ ${want}`);

  // 채점기 — 대시보드가 쓰는 것과 같은 함수여야 한다
  ok('사전에 없는 말은 중립', s('오늘 날씨 어떤가요') === 0);
  ok('개선(1)은 1/2.2 로 정규화', near(s('실적 개선'), 1 / 2.2));
  ok('부정어가 극성을 뒤집는다', near(s('안 떨어졌다'), 2 / 2.2));
  ok('상하한 -1..+1 로 잘린다', s('떡상 대박 신고가 우상향') === 1);
  ok('긍부정이 섞이면 상쇄', s('상승 하락') === 0);

  // 거래일 변환 — 여기가 틀리면 시차 상관 전체가 하루씩 밀린다
  ok('KST 새벽은 전날 미 동부 장 마감 후',
    et('2026-08-14T05:33:00+09:00').date === '2026-08-13');
  ok('KST 새벽 글은 정규장 아님', et('2026-08-14T05:33:00+09:00').intraday === false);
  ok('KST 23:00 은 같은 날 미 동부 정규장',
    et('2026-08-13T23:00:00+09:00').date === '2026-08-13'
    && et('2026-08-13T23:00:00+09:00').intraday === true);
  ok('개장 09:30 ET 는 정규장 포함', et('2026-08-13T09:30:00-04:00').intraday === true);
  ok('마감 16:00 ET 는 정규장 제외', et('2026-08-13T16:00:00-04:00').intraday === false);
  // 서머타임: 3월 둘째 일요일 이후는 EDT(-4), 그 전은 EST(-5)
  ok('서머타임 전 EST', et('2026-01-15T14:00:00-05:00').date === '2026-01-15'
    && et('2026-01-15T14:00:00-05:00').intraday === true);
  ok('서머타임 후 EDT', et('2026-07-15T14:00:00-04:00').date === '2026-07-15'
    && et('2026-07-15T14:00:00-04:00').intraday === true);

  // 집계 — 주말 글이 다음 거래일로 넘어가는가
  const trading = ['2026-08-13', '2026-08-14', '2026-08-17'];   // 15·16 은 주말
  const daily = aggregate([
    { at: '2026-08-13T10:00:00-04:00', text: '상승' },      // 목 정규장
    { at: '2026-08-13T18:00:00-04:00', text: '하락' },      // 목 마감 후
    { at: '2026-08-15T11:00:00-04:00', text: '떡상' },      // 토 → 월(17)로
    { at: '2026-08-17T10:00:00-04:00', text: '폭락' },      // 월 정규장
  ], trading, s);

  ok('목요일 2건', daily['2026-08-13'].posts === 2);
  ok('그중 정규장은 1건', daily['2026-08-13'].postsIntra === 1);
  ok('전체는 상쇄되어 0', daily['2026-08-13'].sentiment === 0);
  ok('정규장만 보면 양수', daily['2026-08-13'].sentimentIntra > 0);
  ok('토요일 글은 월요일로', daily['2026-08-17'].posts === 2);
  ok('토요일 글은 정규장 아님', daily['2026-08-17'].postsIntra === 1);
  ok('휴장일 자체 버킷은 없음', daily['2026-08-15'] === undefined);
  ok('거래일 없는 날은 통째로 빠짐', Object.keys(daily).length === 2);

  // 공포 축 — 부정과 갈라지는가
  ok('공포어를 잡는다', hasFear('지금 너무 무섭다') === true);
  ok('항복도 공포다', hasFear('결국 손절했습니다') === true);
  ok('부정이지만 공포는 아님', hasFear('오늘 하락했고 실적도 악재') === false);
  ok('긍정문은 공포 아님', hasFear('급등 호재 대박') === false);
  ok('앞 부정어는 걸러낸다', hasFear('하나도 안 무섭다') === false);
  ok('빈 글은 공포 아님', hasFear('') === false && hasFear(null) === false);

  // 공포는 비율로 집계된다
  const fd = aggregate([
    { at: '2026-08-13T10:00:00-04:00', text: '무섭다' },
    { at: '2026-08-13T11:00:00-04:00', text: '급등' },
    { at: '2026-08-13T12:00:00-04:00', text: '급등' },
    { at: '2026-08-13T13:00:00-04:00', text: '급등' },
  ], ['2026-08-13'], s, hasFear);
  eq('공포 비율 = 1/4', fd['2026-08-13'].fear, 0.25);
  eq('장중 공포 비율도 1/4', fd['2026-08-13'].fearIntra, 0.25);

  // 기준선 — 시간대별로 갈라지는가
  const posts = [];
  for (let d = 1; d <= 10; d++) {
    const date = `2026-07-${String(d).padStart(2, '0')}`;
    // 10시: 30건 중 3건 공포(10%) / 14시: 30건 중 15건 공포(50%)
    for (let k = 0; k < 30; k++) posts.push({ at: `${date}T10:00:00-04:00`, text: k < 3 ? '무섭다' : '보통' });
    for (let k = 0; k < 30; k++) posts.push({ at: `${date}T14:00:00-04:00`, text: k < 15 ? '무섭다' : '보통' });
  }
  const bl = fearBaseline(posts, hasFear);
  eq('10시 기준선 10%', bl.hourly[10].mean, 0.1);
  eq('14시 기준선 50%', bl.hourly[14].mean, 0.5);
  ok('시간대별로 다른 값을 준다', bl.hourly[10].mean !== bl.hourly[14].mean);
  eq('10시 표본 10일', bl.hourly[10].n, 10);
  ok('변동이 없으면 표준편차 0', bl.hourly[10].sd === 0);
  ok('글이 적은 시간대는 기준선 없음', bl.hourly[3] === undefined);

  // 일별 기준선 — 차트가 그리는 그 열의 분포
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push({ posts: 100, postsIntra: 100, fear: i < 5 ? 0.04 : 0.06, fearIntra: 0.05 });
  }
  rows.push({ posts: 3, postsIntra: 3, fear: 0.9, fearIntra: 0.9 });   // 표본 적은 날
  const db = dailyBaseline(rows);
  eq('일별 기준선 평균 5%', db.all.mean, 0.05);
  eq('일별 기준선 표본 10일', db.all.n, 10);
  ok('글 적은 날은 기준선에서 뺀다', db.all.mean < 0.06);
  ok('변동 없으면 표준편차 0', db.intra.sd === 0);
  ok('날이 모자라면 기준선 없음', dailyBaseline(rows.slice(0, 3)).all === null);

  // 계수 기준선 — 빈 버킷을 세는지, 주말을 빼는지
  {
    // 2026-08-03(월) ~ 08-07(금) ET 10시대에 매분 공포글 1건, 나머지 분은 0건
    const cp = [];
    for (const d of [3, 4, 5, 6, 7, 8, 9]) {          // 8·9 는 토·일
      for (let m = 0; m < 60; m++) {
        cp.push({ at: `2026-08-${String(d).padStart(2, '0')}T10:${String(m).padStart(2, '0')}:00-04:00`,
                  text: d >= 8 ? '무섭다' : (m < 30 ? '무섭다' : '보통') });
      }
    }
    const cb = countBaseline(cp, hasFear);
    const h10 = cb['min:1'].hourly[10];
    eq('1분 계수 기준선 = 절반이 공포', h10.mean, 0.5);
    ok('주말은 표본에서 뺀다', h10.n === 5 * 60, String(h10.n));
    ok('빈 버킷도 0 으로 센다', h10.mean < 1);
    ok('10분 기준선도 만든다', cb['min:10'].hourly[10] !== undefined);
    ok('일봉 기준선은 시각 축이 없다', cb['day:1'].overall !== null);
    ok('글이 없으면 기준선도 없다', countBaseline([], hasFear) === null);
  }

  // 공포 강도 — 계수 → 0~100
  eq('평소면 50', fearIntensity(0.6, { mean: 0.6, sd: 1 }), 50);
  eq('2 표준편차면 90', fearIntensity(2.6, { mean: 0.6, sd: 1 }), 90);
  eq('위로 100 에서 멈춘다', fearIntensity(50, { mean: 0.6, sd: 1 }), 100);
  eq('아래로 0 에서 멈춘다', fearIntensity(-50, { mean: 0.6, sd: 1 }), 0);
  ok('표준편차 0 이면 강도 없음', fearIntensity(1, { mean: 0, sd: 0 }) === null);
  ok('개수가 없으면 강도도 없음', fearIntensity(null, { mean: 0.6, sd: 1 }) === null);

  // 공포지수 — 0~100 로 펴기
  eq('z 0 이면 50', fearIndex(0.05, { mean: 0.05, sd: 0.01 }), 50);
  eq('z 2 면 90 (경보선)', fearIndex(0.07, { mean: 0.05, sd: 0.01 }), 90);
  eq('z -2 면 10', fearIndex(0.03, { mean: 0.05, sd: 0.01 }), 10);
  eq('위로 100 에서 멈춘다', fearIndex(0.5, { mean: 0.05, sd: 0.01 }), 100);
  eq('아래로 0 에서 멈춘다', fearIndex(0, { mean: 0.05, sd: 0.01 }), 0);
  ok('경보선은 z 2 지점', FEAR_ALERT === 90);
  ok('비율이 없으면 지수도 없다', fearIndex(null, { mean: 0.05, sd: 0.01 }) === null);
  ok('표준편차 0 이면 지수 없음', fearIndex(0.05, { mean: 0.05, sd: 0 }) === null);
  ok('기준선이 없으면 지수 없음', fearIndex(0.05, null) === null);

  console.log(`\n${n}개 점검 통과\n`);
}

// ── 메인 ─────────────────────────────────────────────────────
try {
  if (argv.includes('--selftest')) { console.log('\n자체 점검\n'); selftest(); process.exit(0); }
  if (!Number.isFinite(DAYS) || DAYS < 2) throw new Error('--days 는 2 이상이어야 합니다.');

  const { LEX_DEFAULT, scoreWith, hasFear, isWail } = loadLexicon();
  const score = t => scoreWith(t, LEX_DEFAULT);

  console.log(`\n빌드 · ${TICKERS.join(' ')} · 최근 ${DAYS} 거래일\n`);

  const tickers = {};
  const missing = [];

  for (const ticker of TICKERS) {
    const { code, name } = await resolveStock(ticker);

    // 여유 있게 받아서(달력일 ≠ 거래일) 뒤에서 잘라낸다
    const all = await fetchCandles(code, Math.max(60, DAYS * 3));
    const candles = all.slice(-DAYS);
    if (!candles.length) throw new Error(`${ticker}: 일봉이 비어 있습니다.`);
    const dates = candles.map(c => c.date);

    const p = join(DATA, `${ticker}.posts.json`);
    let posts = [];
    if (existsSync(p)) {
      try { posts = JSON.parse(readFileSync(p, 'utf8')); }
      catch (e) { console.warn(`  ${ticker}.posts.json 을 읽지 못했습니다: ${e.message}`); }
    } else {
      missing.push(ticker);
    }

    const daily = aggregate(posts, dates, score, hasFear);
    const days = candles.map(c => ({
      date: c.date,
      close: c.close,
      // 캔들·거래량. 옛 일봉 응답에 없을 수도 있어 유한한 값일 때만 싣는다.
      ...(Number.isFinite(c.open) ? { open: c.open, high: c.high, low: c.low } : {}),
      ...(Number.isFinite(c.volume) ? { volume: c.volume } : {}),
      posts: daily[c.date]?.posts ?? 0,
      sentiment: daily[c.date]?.sentiment ?? null,
      postsIntra: daily[c.date]?.postsIntra ?? 0,
      sentimentIntra: daily[c.date]?.sentimentIntra ?? null,
      fear: daily[c.date]?.fear ?? null,
      fearIntra: daily[c.date]?.fearIntra ?? null,
    }));

    const baseline = fearBaseline(posts, hasFear);
    baseline.daily = dailyBaseline(days);
    baseline.counts = countBaseline(posts, hasFear);   // 봉 단위별 계수 기준선
    // 곡소리는 공포보다 넓다(부정 전부). 기준선도 따로 있어야 z 가 맞는다.
    baseline.wailCounts = countBaseline(posts, isWail);
    tickers[ticker] = { name, code, days, baseline };
    const withSent = days.filter(d => d.posts > 0).length;
    const bl = baseline;
    console.log(`  ${ticker.padEnd(6)} ${String(name).padEnd(20)} `
      + `${days.length}일  게시글 ${posts.length}건  감정 있는 날 ${withSent}/${days.length}`
      + `  공포 ${bl.overall ? (bl.overall.mean*100).toFixed(2)+'%' : '—'}`
      + ` (기준선 ${Object.keys(bl.hourly).length}/24시)`);
  }

  // 빌드 시점의 USD→KRW. 원화 표시는 이 한 값으로 환산한다 —
  // 과거 날짜별 환율까지 맞추지는 않는다(그러면 주가 변동과 환율 변동이 섞인다).
  let rate = null;
  try { rate = await fetchRate(); } catch (e) { console.warn(`  환율을 받지 못했습니다: ${e.message}`); }

  const out = { builtAt: new Date().toISOString(), days: DAYS, list: TICKERS, rate, tickers };
  writeFileSync(BASELINE_FILE,
    `// 자동 생성 — build.mjs\nwindow.STOCK_DATA = ${JSON.stringify(out)};\n`);

  const any = Object.values(tickers)[0].days;
  console.log(`
  data.js 생성 완료
    기간   ${any[0].date} ~ ${any[any.length - 1].date}
    종목   ${TICKERS.length}개
`);
  if (missing.length) {
    console.log(`  게시글이 없는 종목: ${missing.join(', ')}`);
    console.log(`  → node fetch-comments.mjs ${missing.join(' ')} --days ${DAYS}\n`);
  }
  console.log('  index.html 을 열면 이 데이터를 씁니다.\n');
} catch (e) {
  console.error(`\n실패: ${e.message}\n`);
  process.exit(1);
}
