/**
 * 실시간 커뮤니티 온도 서버.
 *
 *   node server.mjs              # http://localhost:8731
 *   node server.mjs --port 9000
 *   node server.mjs --poll 15      # 폴링 주기(초). 기본 5
 *   node server.mjs --selftest   # 네트워크 없이 글 열람 필터만 점검
 *
 * 하는 일 두 가지:
 *   1. 정적 파일 서빙 (index.html, live.html, data.js, lexicon.js)
 *   2. 15초마다 토스에서 최신 글·현재가를 받아 캐시하고 /api/live 로 내보내기
 *   3. 수집해 둔 글을 /api/posts 로 검색·열람
 *   4. 봉 차트를 /api/candles 로 중계 (1/10/60분·일봉)
 *   5. 봉에 맞춘 과거 공포 강도를 /api/fear 로 계산
 *
 * 프록시가 필요한 이유: 브라우저에서 토스 API 를 직접 부르면 403 이다.
 * Origin 헤더가 붙는 순간 거절당한다(CORS 헤더가 없는 정도가 아니라 서버가 막는다).
 * 그래서 Node 가 대신 부르고 결과만 넘긴다.
 *
 * 기준선은 data.js 에서 읽는다. 먼저 `node build.mjs` 를 돌려야 한다.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveStock, fetchLatest, fetchPrice, fetchRate, fetchBars, UNITS, MAX_COUNT, et, sleep } from './toss.mjs';
import { loadTickers, saveTickers, okSymbol, TICKERS_FILE } from './tickers.mjs';
import { spawn } from 'node:child_process';

// 목록은 화면에서 바뀔 수 있다. 모듈 상수로 잡아두면 추가해도 서버가 모른다.
// 한 요청 안에서는 같은 값을 봐야 하므로 캐시하고, 바꿀 때만 갈아엎는다.
let TICKERS = loadTickers();
function refreshTickers() {
  TICKERS = loadTickers();
  return TICKERS;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const pi = argv.indexOf('--port');
const PORT = Number(pi >= 0 ? argv[pi + 1] : 8731);

const pollArg = argv.indexOf('--poll');
// 폴링 주기(초). 짧을수록 반응이 빠르지만 토스에 나가는 요청이 그만큼 는다.
// 5초 = 종목당 시간당 720회 남짓. 한 번 도는 데 보통 0.6초라 5초면 겹치지 않는다.
// 그래도 느려질 때를 대비해 아래에 겹침 방지가 있다.
const POLL_MS = Math.max(2_000, (Number(pollArg >= 0 ? argv[pollArg + 1] : 5) || 5) * 1000);

// 수집은 30일치를 그대로 받아 둔다(기준선을 만들려면 그만큼 필요하다).
// 다만 메모리에 올려 훑는 건 최근 며칠만 한다 — SNDK 13.8MB 를 통째로 파싱하면
// 1GB 짜리 서버에서 힙이 53MB 씩 튄다. 글 탭에서 한 달 전 글을 뒤질 일은 드물다.
const daysArg = argv.indexOf('--load-days');
const LOAD_DAYS = Math.max(1, Number(daysArg >= 0 ? argv[daysArg + 1] : 5) || 5);
const WINDOW_MIN = 60;       // 가장 긴 창 — 이보다 오래된 글은 버린다
const FAST_MIN = 15;         // 민감한 창
const MAX_PAGES = 6;         // 평상시 폴링 상한(66건). 폭주 구간 대비
const WARMUP_PAGES = 60;     // 기동 직후 60분 창을 한 번에 채울 때의 상한(660건)
const MIN_LIVE = 20;         // 60분 창에 이만큼은 있어야 비율을 말할 수 있다
const MIN_FAST = 10;         // 15분 창의 최소치. 창이 1/4 이라 기준도 낮다

// 봉 단위 → 창 길이(분) · 그 봉의 계수 기준선.
// 창을 봉 길이에 맞추면 카드의 공포지수가 차트 마지막 봉과 같은 숫자가 된다.
// 창을 따로 잡으면 같은 화면에 다른 숫자가 두 개 뜬다.
//
// 일봉은 여기 없다. 폴러가 60분치만 들고 있어서 하루 창을 못 만든다.
// 일봉을 보고 있으면 화면이 '60' 으로 물러난다.
const UNIT_WIN = { 1: 1, 10: 10, 60: 60 };
const SAMPLE_MS = 60_000;    // 계열에 점을 찍는 간격. 폴링(15초)마다 찍으면 4배로 두꺼워진다
const SERIES_KEEP = 1440;    // 종목당 보관 점수 = 24시간
const SERIES_SEND = 180;     // SSE 로 내보내는 점수 = 최근 3시간
const SERIES_SAVE = 20;      // 이만큼 새 점이 쌓이면 디스크에 쓴다(≈20분)
// 비율의 표준오차는 sqrt(p(1-p)/n) 이다. p=5%, n=20 이면 4.9% — 값 자체만큼 크다.
// 그래서 이 문턱은 "쓸 만하다"가 아니라 "이 아래는 아예 말하지 않는다"는 선이고,
// 실제 방어는 기준선 대비 z 가 한다. 기준선이 그 변동성을 이미 겪어봤기 때문이다.

// ── 접근키 ───────────────────────────────────────────────────
// "링크 있는 사람만" 을 실제로 강제한다. 터널 주소가 길고 랜덤인 건 보안이 아니라 운이다.
// 키는 .access-key 에 남겨 재시작해도 링크가 안 죽는다. 지우면 새로 발급된다.
// 첫 요청에 ?k=... 가 맞으면 쿠키를 심어, 이후 data.js·SSE 요청은 파라미터 없이 통과한다.
function loadKey() {
  const p = join(HERE, '.access-key');
  if (existsSync(p)) {
    const k = readFileSync(p, 'utf8').trim();
    if (k.length >= 16) return k;
  }
  const k = randomBytes(16).toString('base64url');
  writeFileSync(p, k + '\n');
  return k;
}
const KEY = loadKey();

// 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다
function keyOk(given) {
  if (typeof given !== 'string' || given.length !== KEY.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(KEY));
}

function cookieOf(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** 통과하면 true. 막으면 응답까지 마치고 false. */
function authed(req, res) {
  const given = new URL(req.url, 'http://x').searchParams.get('k');
  if (keyOk(given)) {
    // 키를 쿠키로 옮겨 심는다 — 주소창에 계속 달고 다니지 않아도 된다
    res.setHeader('Set-Cookie',
      `k=${encodeURIComponent(KEY)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
    return true;
  }
  if (keyOk(cookieOf(req, 'k'))) return true;

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('없는 경로입니다');
  return false;
}

// ── 사전 (build.mjs 와 같은 파일) ─────────────────────────────
function loadLexicon() {
  const w = {};
  new Function('window', readFileSync(join(HERE, 'lexicon.js'), 'utf8'))(w);
  return w;
}
const LEX = loadLexicon();
const score = t => LEX.scoreWith(t, LEX.LEX_DEFAULT);
const intensity = (n, base) => LEX.fearIntensity(n, base);
const hasFear = t => LEX.hasFear(t);
const isWail = t => LEX.isWail(t);

// ── 기준선 (data.js 에서) ────────────────────────────────────
function loadBaselines() {
  const p = join(HERE, 'data.js');
  if (!existsSync(p)) return null;
  const w = {};
  try {
    new Function('window', readFileSync(p, 'utf8'))(w);
    return w.STOCK_DATA?.tickers ?? null;
  } catch (e) {
    console.warn(`  data.js 를 읽지 못했습니다: ${e.message}`);
    return null;
  }
}
let SNAPSHOT = loadBaselines();
if (!SNAPSHOT) {
  console.warn('\n  data.js 가 없습니다. 공포 z-score 없이 원시 비율만 나옵니다.');
  console.warn('  → node build.mjs 를 먼저 돌리세요.\n');
}

// ── 수집된 글 열람 ───────────────────────────────────────────
// data/{티커}.posts.json 은 SNDK 만 13.8MB 다. 다섯 종목을 전부 메모리에 얹으면
// 서버가 250MB 를 넘는다. 보고 있는 종목 하나만 들고 있다가 갈아끼운다.
// 실측: 파싱 130ms + 채점 450ms, 힙 53MB (10만 건).
//
// 여기 나오는 글은 마지막 수집(fetch-comments.mjs) 시점까지다. 그 뒤 글은
// 실시간 탭에 있다. 두 탭이 보는 데이터가 다르다.
const POSTS_DIR = join(HERE, 'data');
const PAGE_SIZE = 50;
let CACHE = { ticker: null, rows: null, stamp: 0 };

function loadPosts(ticker) {
  const f = join(POSTS_DIR, `${ticker}.posts.json`);
  // collect 는 서버가 떠 있는 채로 돈다. 파일이 바뀌었으면 다시 읽어야
  // 방금 받은 글이 화면에 나온다.
  const stamp = existsSync(f) ? statSync(f).mtimeMs : 0;
  if (CACHE.ticker === ticker && CACHE.stamp === stamp) return CACHE.rows;
  let rows = [];
  if (existsSync(f)) {
    try {
      // 자르는 게 먼저다. 채점 전에 걸러야 안 쓸 글을 채점하지 않는다.
      // 채점은 읽을 때 한 번만 한다. 요청마다 다시 하면 페이지 넘길 때마다 0.5초씩 든다.
      const cut = Date.now() - LOAD_DAYS * 86_400_000;
      rows = JSON.parse(readFileSync(f, 'utf8'))
        .filter(p => Date.parse(p.at) >= cut)
        .map(p => ({
          id: p.id, at: p.at, text: p.text, likes: p.likes ?? 0, img: p.img ?? null,
          s: +score(p.text).toFixed(3), f: hasFear(p.text), g: isWail(p.text), d: et(p.at).date,
        }));
      rows.reverse();                     // 파일은 오래된 순 — 최신을 앞으로
    } catch (e) {
      console.warn(`  ${ticker}.posts.json 을 읽지 못했습니다: ${e.message}`);
    }
  }
  CACHE = { ticker, rows, stamp };
  return rows;
}

/** 순수 함수 — 디스크를 안 탄다. --selftest 가 여기를 때린다. */
export function filterPosts(rows, o) {
  let hits = rows;
  if (o.mood === 'fear') hits = hits.filter(r => r.f);
  else if (o.mood === 'pos') hits = hits.filter(r => r.s > 0);
  else if (o.mood === 'neg') hits = hits.filter(r => r.s < 0);
  if (o.from) hits = hits.filter(r => r.d >= o.from);
  if (o.to) hits = hits.filter(r => r.d <= o.to);
  if (o.term) {
    const t = o.term.toLowerCase();
    hits = hits.filter(r => r.text.toLowerCase().includes(t));
  }
  // 최신순은 이미 그 순서다 — 좋아요순일 때만 복사해서 정렬한다.
  // 원본을 제자리 정렬하면 캐시된 배열의 순서가 영구히 망가진다.
  if (o.sort === 'likes') hits = hits.slice().sort((a, b) => b.likes - a.likes);

  const page = Math.max(0, o.page | 0);
  const start = page * PAGE_SIZE;
  return {
    total: rows.length, matched: hits.length, loadDays: LOAD_DAYS,
    page, pages: Math.ceil(hits.length / PAGE_SIZE), size: PAGE_SIZE,
    fear: hits.filter(r => r.f).length,
    rows: hits.slice(start, start + PAGE_SIZE),
  };
}

function queryPosts(q) {
  const ticker = TICKERS.includes(q.get('t')) ? q.get('t') : TICKERS[0];
  return { ticker, ...filterPosts(loadPosts(ticker), {
    mood: q.get('mood') || 'all',
    term: (q.get('q') || '').trim(),
    from: q.get('from') || '',
    to: q.get('to') || '',
    sort: q.get('sort') === 'likes' ? 'likes' : 'new',
    page: Number(q.get('page')) || 0,
  }) };
}

// ── 자체 점검 (네트워크·디스크 없음) ─────────────────────────
function selftest() {
  let n = 0;
  const ok = (label, cond, extra = '') => {
    if (!cond) throw new Error(`${label}  ${extra}`);
    n++; console.log(`  PASS  ${label}`);
  };
  // 최신순으로 미리 정렬된 배열을 흉내낸다
  const rows = [
    { id: 3, at: 'x', text: '무섭다 손절', likes: 5, s: -0.5, f: true,  d: '2026-08-13' },
    { id: 2, at: 'x', text: '가즈아',      likes: 9, s:  0.4, f: false, d: '2026-08-12' },
    { id: 1, at: 'x', text: '보합',        likes: 0, s:  0,   f: false, d: '2026-08-11' },
  ];
  const f = o => filterPosts(rows, { mood: 'all', sort: 'new', page: 0, ...o });

  ok('기본은 전부', f({}).matched === 3);
  ok('전체 건수는 거른 뒤에도 원본', f({ mood: 'fear' }).total === 3);
  ok('공포만', f({ mood: 'fear' }).matched === 1);
  ok('긍정만', f({ mood: 'pos' }).matched === 1);
  ok('부정만', f({ mood: 'neg' }).matched === 1);
  ok('중립은 긍정에도 부정에도 안 든다',
     f({ mood: 'pos' }).rows[0].id === 2 && f({ mood: 'neg' }).rows[0].id === 3);
  ok('검색은 대소문자를 안 가린다', f({ term: '손절' }).matched === 1);
  ok('없는 말은 0건', f({ term: '없는말' }).matched === 0);
  ok('시작일 경계 포함', f({ from: '2026-08-12' }).matched === 2);
  ok('종료일 경계 포함', f({ to: '2026-08-12' }).matched === 2);
  ok('하루만', f({ from: '2026-08-12', to: '2026-08-12' }).matched === 1);
  ok('조건은 겹쳐 걸린다', f({ mood: 'fear', term: '손절' }).matched === 1);
  ok('공포 건수는 거른 결과 기준', f({ mood: 'pos' }).fear === 0);

  ok('최신순은 원래 순서', f({}).rows.map(r => r.id).join() === '3,2,1');
  ok('좋아요순', f({ sort: 'likes' }).rows.map(r => r.id).join() === '2,3,1');
  ok('정렬해도 원본은 안 흔들린다', rows.map(r => r.id).join() === '3,2,1');

  ok('한 쪽에 다 들어가면 pages 1', f({}).pages === 1);
  ok('빈 결과는 pages 0', f({ term: '없는말' }).pages === 0);
  ok('범위 밖 쪽은 빈 배열', f({ page: 9 }).rows.length === 0);
  ok('음수 쪽은 0 으로', f({ page: -5 }).page === 0);
  const many = Array.from({ length: 120 }, (_, i) =>
    ({ id: i, at: 'x', text: 't', likes: 0, s: 0, f: false, d: '2026-08-13' }));
  const p2 = filterPosts(many, { mood: 'all', sort: 'new', page: 2 });
  ok('50건씩 끊는다', p2.pages === 3 && p2.rows.length === 20, `${p2.pages} ${p2.rows.length}`);
  ok('세 번째 쪽은 101번째부터', p2.rows[0].id === 100);


  // 종목 목록 — 잘못된 값이 파일로 들어와도 앱이 멈추면 안 된다
  ok('영숫자 티커는 통과', okSymbol('TSLA') && okSymbol('BRK.B') && okSymbol('SNDK'));
  ok('경로 문자는 거부', !okSymbol('../etc') && !okSymbol('a/b') && !okSymbol('a b'));
  ok('소문자는 거부 (대문자로 정규화한 뒤에 검사한다)', !okSymbol('tsla'));
  ok('빈 값·긴 값 거부', !okSymbol('') && !okSymbol('ABCDEFGHIJKLM'));

  console.log(`\n${n}개 점검 통과\n`);
}

if (argv.includes('--selftest')) { console.log('\n자체 점검\n'); selftest(); process.exit(0); }

// ── 종목 관리 ────────────────────────────────────────────────
// 새 종목은 목록에 넣는 즉시 폴링이 시작된다. 현재가·봉·글 흐름은 바로 나온다.
// 공포지수만 기준선이 필요해서 수집이 끝날 때까지 비어 있다 — 40~60분.
// 다른 종목 기준선을 빌려 쓸 수는 없다. 평소 공포율이 종목마다 2배 가까이 다르다.
const JOBS = new Map();            // 티커 → { phase, pages, posts, startedAt, error }

async function addTicker(sym) {
  sym = String(sym ?? "").toUpperCase();
  if (!okSymbol(sym)) throw new Error(`티커 형식이 잘못됐습니다: ${sym}`);
  const now = loadTickers();
  if (now.includes(sym)) throw new Error(`${sym} 는 이미 목록에 있습니다.`);

  // 토스가 아는 종목인지 먼저 확인한다. 없는 티커를 넣으면 폴링이 계속 실패한다.
  const m = await resolveStock(sym);

  saveTickers([...now, sym]);
  refreshTickers();
  LIVE.set(sym, { code: m.code, name: m.name, posts: new Map(), price: null, error: null });
  collectInBackground([sym]);
  return m;
}

function removeTicker(sym) {
  const now = loadTickers();
  if (!now.includes(sym)) throw new Error(`${sym} 는 목록에 없습니다.`);
  if (now.length === 1) throw new Error("마지막 종목은 지울 수 없습니다.");
  saveTickers(now.filter(t => t !== sym));
  refreshTickers();
  LIVE.delete(sym); SERIES.delete(sym); JOBS.delete(sym);
  // 글 아카이브(data/*.posts.json)는 남긴다. 실수로 날리면 다시 40~60분이다.
  return sym;
}

/** 수집 → 빌드를 뒤에서 돌린다. 서버는 그동안 계속 응답한다. */
function collectInBackground(list) {
  for (const t of list) JOBS.set(t, { phase: "수집 대기", pages: 0, posts: 0, startedAt: Date.now() });
  // 자식 힙을 묶어 둔다. 이 기계가 1GB 라 서버까지 같이 죽으면 안 된다.
  const node = process.execPath;
  const opts = { cwd: HERE, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=256" } };

  const fetcher = spawn(node, ["fetch-comments.mjs", ...list, "--days", "30"], opts);
  const mark = (o) => { for (const t of list) JOBS.set(t, { ...(JOBS.get(t) ?? {}), ...o }); };
  mark({ phase: "글 수집 중" });

  let buf = "";
  fetcher.stdout.on("data", d => {
    buf = (buf + d).slice(-400);
    const m = /(\d+)페이지 · (\d+)건/.exec(buf.split("\r").pop() ?? "");
    if (m) mark({ pages: +m[1], posts: +m[2] });
  });
  fetcher.on("close", code => {
    if (code !== 0) return mark({ phase: "실패", error: `수집이 코드 ${code} 로 끝났습니다` });
    mark({ phase: "기준선 계산 중" });
    const builder = spawn(node, ["build.mjs", "--days", "30"], opts);
    builder.on("close", c2 => {
      if (c2 !== 0) return mark({ phase: "실패", error: `빌드가 코드 ${c2} 로 끝났습니다` });
      SNAPSHOT = loadBaselines();          // 새 기준선을 즉시 물린다
      CACHE = { ticker: null, rows: null, stamp: 0 };
      for (const t of list) JOBS.delete(t);
    });
  });
}

// ── 봉 차트 ──────────────────────────────────────────────────
// 브라우저가 토스를 직접 부르면 403 이라 여기서 대신 부른다.
// 같은 (종목, 단위) 를 여러 사람이 동시에 보면 매번 나가지 않도록 잠깐 캐시한다.
// 캐시 수명은 봉 길이에 맞춘다 — 60분봉을 20초마다 다시 받을 이유가 없다.
const BARS = new Map();            // "티커|단위" → { at, rows }

async function getBars(ticker, unit) {
  const key = `${ticker}|${unit}`;
  const hit = BARS.get(key);
  if (hit && Date.now() - hit.at < UNITS[unit].cache) return hit.rows;
  const st = LIVE.get(ticker);
  if (!st) throw new Error(`모르는 종목입니다: ${ticker}`);
  const rows = await fetchBars(st.code, unit, MAX_COUNT);
  BARS.set(key, { at: Date.now(), rows });
  return rows;
}

// ── 봉에 맞춘 공포 강도 ──────────────────────────────────────
// 봉이 준 타임스탬프에 그대로 정렬한다. 자체 격자를 쓰면 두 차트가 반 칸씩 어긋난다.
//
// 각 봉의 값 = 그 봉이 덮는 구간에 온 공포 글 수 → 그 종목·그 ET 시각 기준선 대비 z.
// 비율을 안 쓰는 이유는 lexicon.js 의 fearIntensity 주석에 있다.
const ET_HOUR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });

function fearSeries(ticker, unit, bars) {
  const rows = loadPosts(ticker);
  const bl = SNAPSHOT?.[ticker]?.baseline?.counts?.[unit];
  const wbl = SNAPSHOT?.[ticker]?.baseline?.wailCounts?.[unit];
  const out = [];
  if (!bars.length) return { rows: out, covers: null };

  // 글은 최신순으로 캐시돼 있다. 훑으려면 오래된 순이 편하다.
  const asc = rows.slice().reverse();
  const stamps = asc.map(r => Date.parse(r.at));

  // 봉 i 가 덮는 구간 = (이전 봉 시각, 이 봉 시각]. 첫 봉은 봉 간격만큼 뒤로 잡는다.
  //
  // 다만 봉 길이를 넘지 않게 자른다. 장이 쉰 뒤 첫 봉은 이전 봉과 사흘이 떨어져 있어서,
  // 그대로 두면 그 10분봉 하나가 주말 사흘치 글을 통째로 삼킨다.
  // 봉 간격은 최빈값으로 잡는다 — bars[1]-bars[0] 만 보면 그 자리가 마침 휴장 경계일 때 틀린다.
  const gaps = [];
  for (let i = 1; i < bars.length; i++) gaps.push(bars[i][0] - bars[i - 1][0]);
  const tally = new Map();
  for (const g of gaps) tally.set(g, (tally.get(g) ?? 0) + 1);
  const step = gaps.length
    ? [...tally.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    : 60_000;
  let j = 0;
  for (let i = 0; i < bars.length; i++) {
    const at = bars[i][0];
    const from = Math.max(i ? bars[i - 1][0] : -Infinity, at - step);
    while (j < stamps.length && stamps[j] <= from) j++;
    let n = 0, f = 0, g = 0;
    let k = j;
    while (k < stamps.length && stamps[k] <= at) { n++; if (asc[k].f) f++; if (asc[k].g) g++; k++; }
    j = k;
    const h = +ET_HOUR.format(new Date(at));
    const b = bl?.hourly?.[h] ?? bl?.overall ?? null;
    const bw = wbl?.hourly?.[h] ?? wbl?.overall ?? null;
    // [시각, 공포글, 전체글, 공포지수, 곡소리글, 곡소리지수]
    out.push([at, f, n, b ? +intensity(f, b).toFixed(1) : null,
              g, bw ? +intensity(g, bw).toFixed(1) : null]);
  }

  // 글 보관은 마지막 수집 시점까지다. 그 뒤 봉은 값이 아니라 공백이어야 한다.
  const last = stamps.length ? stamps[stamps.length - 1] : null;
  if (last !== null) for (const r of out) if (r[0] > last + step) { r[1] = 0; r[2] = 0; r[3] = null; r[4] = 0; r[5] = null; }

  return { rows: out, covers: last, unit, hasBaseline: !!bl };
}

// ── 시계열 ───────────────────────────────────────────────────
// 실시간 화면이 선을 그리려면 과거가 있어야 한다. 폴링 결과를 1분에 한 점씩 쌓는다.
// 점 하나 = [시각ms, 공포비율, 공포지수, 가격]. 객체로 두면 JSON 이 3배가 된다.
//
// 파일에 남기는 이유: 서버를 다시 켤 때마다 선이 빈 화면부터 시작하면,
// 3시간을 기다려야 뭔가 보인다. 재시작이 잦은 개발 중에는 특히 그렇다.
const SERIES_FILE = join(HERE, 'data', 'series.json');
const SERIES = new Map();          // 티커 → [[ms, fear, idx, price], ...] 오래된 순
let sinceSave = 0;

function loadSeries() {
  if (!existsSync(SERIES_FILE)) return;
  try {
    const j = JSON.parse(readFileSync(SERIES_FILE, 'utf8'));
    const cut = Date.now() - SERIES_KEEP * SAMPLE_MS;
    for (const t of TICKERS) {
      const rows = Array.isArray(j[t]) ? j[t].filter(r => r[0] > cut) : [];
      SERIES.set(t, rows.slice(-SERIES_KEEP));
    }
  } catch (e) {
    console.warn(`  series.json 을 읽지 못했습니다: ${e.message}`);
  }
}

function saveSeries() {
  try {
    writeFileSync(SERIES_FILE, JSON.stringify(Object.fromEntries(SERIES)));
    sinceSave = 0;
  } catch (e) {
    console.warn(`\n  series.json 을 쓰지 못했습니다: ${e.message}`);
  }
}

/** 이번 스냅샷에서 한 점을 찍는다. 마지막 점이 1분 안이면 건너뛴다. */
function sample(snap) {
  const now = Date.now();
  for (const t of TICKERS) {
    const d = snap.tickers[t];
    if (!d) continue;                          // 방금 지운 종목
    const arr = SERIES.get(t) ?? [];
    if (arr.length && now - arr[arr.length - 1][0] < SAMPLE_MS) continue;
    // 창을 채우는 중이거나 표본이 모자라면 값을 지어내지 않는다 — null 이면 선이 끊긴다
    const fear = d.w60.thin || d.warming ? null : d.w60.fear;
    const idx = d.w60.z === null ? null : Math.max(0, Math.min(100, 50 + 20 * d.w60.z));
    arr.push([now, fear, idx === null ? null : +idx.toFixed(1), d.price?.close ?? null]);
    if (arr.length > SERIES_KEEP) arr.splice(0, arr.length - SERIES_KEEP);
    SERIES.set(t, arr);
    sinceSave++;
  }
  if (sinceSave >= SERIES_SAVE) saveSeries();
}

// ── 상태 ─────────────────────────────────────────────────────
/** 티커 → { code, name, posts: Map(id→post), price, priceAt, error } */
const LIVE = new Map();
let lastPoll = null, pollErrors = 0, lastPollDur = null;
let RATE = null;                 // { rate, baseDate } — USD→KRW

const minutesAgo = iso => (Date.now() - new Date(iso).getTime()) / 60000;

/**
 * 한 종목 폴링: 이미 본 글을 만날 때까지, 창 밖으로 나갈 때까지, 또는 페이지 상한까지.
 *
 * 기동 직후에는 상한을 크게 잡아 60분치를 한 번에 채운다. 안 그러면 창이 15분치만
 * 찬 상태로 60분 기준선과 비교하게 되어, 글이 적어 보이니 z 가 실제보다 낮게 나온다.
 */
async function pollTicker(ticker, warmup = false) {
  const st = LIVE.get(ticker);
  const cap = warmup ? WARMUP_PAGES : MAX_PAGES;
  let cursor = null, pages = 0, added = 0;

  while (pages < cap) {
    const { posts, key, hasNext } = await fetchLatest(st.code, cursor);
    if (!posts.length) break;

    let hitKnown = false, tooOld = false;
    for (const p of posts) {
      if (minutesAgo(p.at) > WINDOW_MIN) { tooOld = true; continue; }
      if (st.posts.has(p.id)) { hitKnown = true; continue; }
      st.posts.set(p.id, { ...p, score: score(p.text), fear: hasFear(p.text), wail: isWail(p.text) });
      added++;
    }
    pages++;
    // 창 밖까지 갔으면 끝. 워밍업 중에는 이미 본 글을 만나도 계속 판다 —
    // 창을 채우는 게 목적이라 중복은 건너뛰기만 하면 된다.
    if (tooOld || !hasNext || key === cursor) break;
    if (hitKnown && !warmup) break;
    cursor = key;
    await sleep(80);
  }

  // 창 밖 정리
  for (const [id, p] of st.posts) if (minutesAgo(p.at) > WINDOW_MIN) st.posts.delete(id);
  return { added, pages };
}

async function pollAll(warmup = false) {
  const t0 = Date.now();
  let errs = 0;

  // 환율은 하루 한 번 고시되니 실패해도 직전 값을 그대로 쓴다
  try { RATE = await fetchRate(); } catch (e) { if (!RATE) console.warn('\n환율 실패:', e.message); }

  for (const ticker of refreshTickers()) {      // 목록이 바뀌었을 수 있다
    const st = LIVE.get(ticker);
    if (!st) continue;                          // 방금 지운 종목
    try {
      await pollTicker(ticker, warmup);
      st.price = await fetchPrice(st.code);
      st.error = null;
    } catch (e) {
      st.error = e.message;
      errs++;
    }
    await sleep(60);
  }
  lastPoll = new Date().toISOString();
  lastPollDur = Date.now() - t0;
  pollErrors = errs;
  broadcast();
  const total = TICKERS.reduce((a, t) => a + LIVE.get(t).posts.size, 0);
  process.stdout.write(`\r  ${lastPoll.slice(11, 19)} · 창 안 ${total}건`
    + (errs ? ` · 실패 ${errs}` : '') + ` · ${Date.now() - t0}ms   `);
}

// ── 지표 ─────────────────────────────────────────────────────
// 표본이 문턱 미달이면 비율을 아예 내보내지 않는다. 12건에서 나온 25% 를
// 화면에 띄우면 게이지가 꽉 차서 "공포 폭발"처럼 보이는데, 실제로는 3명이 쓴 것뿐이다.
function windowStats(posts, minutes, min) {
  const inWin = posts.filter(p => minutesAgo(p.at) <= minutes);
  const n = inWin.length;
  if (n < min) return { n, sentiment: null, fear: null, thin: true };
  return {
    n,
    sentiment: +(inWin.reduce((a, p) => a + p.score, 0) / n).toFixed(4),
    fear: +(inWin.filter(p => p.fear).length / n).toFixed(5),
    thin: false,
  };
}

/**
 * 지금 시각(미 동부)의 기준선 대비 z.
 *
 * 60분 창에만 z 를 매긴다. 기준선은 "그 날 그 시간대 전체 비율"의 분포라 60분과 단위가 맞고,
 * 15분 창은 표본이 1/4 이라 분산이 원래 더 크다. 같은 기준선에 대면 z 가 부풀려져
 * 없는 공포가 보인다. 그래서 15분은 원시 비율로만 보여주고 60분과 비교하게 둔다.
 */
/**
 * 창 하나의 공포 강도. 차트와 같은 수식이다 — 비율이 아니라 개수로 잰다.
 * 60분 창은 시계로 자른 정시가 아니라 지금부터 뒤로 60분이지만, 기대 개수는
 * 같은 시각의 60분봉과 다르지 않으므로 min:60 기준선을 그대로 쓴다.
 */
function fearIdx(ticker, fearCount) {
  const bl = SNAPSHOT?.[ticker]?.baseline?.counts?.['min:60'];
  if (!bl) return { idx: null, why: '기준선 없음' };
  const hour = Math.floor(et(new Date().toISOString()).min / 60);
  const b = bl.hourly?.[hour];
  if (!b || !b.sd) return { idx: null, why: '이 시간대 기준선이 없습니다' };
  return { idx: +intensity(fearCount, b).toFixed(1), base: b.mean, baseSd: b.sd, baseN: b.n, hour };
}

function fearZ(ticker, fear, n) {
  if (fear === null || n < MIN_LIVE) return { z: null, why: '표본 부족' };
  const bl = SNAPSHOT?.[ticker]?.baseline;
  if (!bl) return { z: null, why: '기준선 없음' };
  const hour = Math.floor(et(new Date().toISOString()).min / 60);
  const b = bl.hourly?.[hour] ?? bl.overall;
  if (!b || !b.sd) return { z: null, why: '기준선 없음' };
  return {
    z: +((fear - b.mean) / b.sd).toFixed(2),
    base: b.mean, baseN: b.n, hour,
    why: bl.hourly?.[hour] ? null : '시간대 기준선이 없어 전체 평균을 씁니다',
  };
}

function snapshot() {
  const out = {};
  for (const ticker of TICKERS) {
    const st = LIVE.get(ticker);
    if (!st) continue;                        // 방금 지운 종목
    const posts = [...st.posts.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
    const w60 = windowStats(posts, WINDOW_MIN, MIN_LIVE);
    const w15 = windowStats(posts, FAST_MIN, MIN_FAST);

    // 창이 실제로 몇 분치나 찼는가. 기동 직후에는 60분치가 아직 없을 수 있는데,
    // 그 상태로 60분 기준선에 대면 글이 적어 보여 z 가 낮게 나온다.
    // 봉 단위별로 같은 계산을 돌린다. 최소 표본은 창 길이에 비례해 잡는다 —
    // 1분 창에 20건을 요구하면 늘 미달이고, 60분 창에 2건을 요구하면 너무 헐겁다.
    const win = {};
    for (const [k, mins] of Object.entries(UNIT_WIN)) {
      const floor = Math.max(3, Math.round(MIN_LIVE * mins / WINDOW_MIN));
      const w = windowStats(posts, mins, floor);
      const fearN = posts.filter(p => p.fear && minutesAgo(p.at) <= mins).length;
      const wailN = posts.filter(p => p.wail && minutesAgo(p.at) <= mins).length;
      const hour = Math.floor(et(new Date().toISOString()).min / 60);
      const bl = SNAPSHOT?.[ticker]?.baseline?.counts?.[`min:${k}`];
      const wl = SNAPSHOT?.[ticker]?.baseline?.wailCounts?.[`min:${k}`];
      const b = bl?.hourly?.[hour];
      const bw = wl?.hourly?.[hour];
      win[k] = { ...w, fearN, wailN, minN: floor, mins,
        idx: b && b.sd ? +intensity(fearN, b).toFixed(1) : null,
        base: b?.mean ?? null, baseSd: b?.sd ?? null, baseN: b?.n ?? null,
        wail: bw && bw.sd ? +intensity(wailN, bw).toFixed(1) : null,
        wailBase: bw?.mean ?? null, wailSd: bw?.sd ?? null,
        why: b ? null : (bl ? '이 시간대 기준선이 없습니다' : '기준선 없음') };
    }

    const oldest = posts.length ? minutesAgo(posts[posts.length - 1].at) : 0;
    const warming = oldest < WINDOW_MIN * 0.8;
    const z60 = warming ? { z: null, why: '창을 채우는 중' } : fearZ(ticker, w60.fear, w60.n);
    // 공포지수는 개수로 낸다. 표본 문턱이 없다 — 0건도 뜻이 있는 값이다.
    const fearN = posts.filter(p => p.fear && minutesAgo(p.at) <= WINDOW_MIN).length;
    const i60 = warming ? { idx: null, why: '창을 채우는 중' } : fearIdx(ticker, fearN);
    // 60분 창이 아직 안 찼어도 1분·10분 창은 벌써 찼을 수 있다.
    if (warming) for (const k of Object.keys(win)) {
      if (UNIT_WIN[k] > oldest) { win[k].idx = null; win[k].why = '창을 채우는 중'; }
    }

    out[ticker] = {
      name: st.name,
      price: st.price,
      error: st.error,
      spanMin: Math.round(oldest),
      warming,
      w60: { ...w60, ...z60, fearN, ...i60 },
      win,                                   // 봉 단위별 창 — 화면이 골라 쓴다
      w15,
      recent: posts.slice(0, 12).map(p => ({ at: p.at, text: p.text, fear: p.fear, score: p.score, img: p.img ?? null })),
    };
  }
  // 보관은 24시간이지만 내보내는 건 최근 3시간뿐이다. 전부 실으면 15초마다 수백 KB 가 나간다.
  const series = {};
  for (const t of TICKERS) series[t] = (SERIES.get(t) ?? []).slice(-SERIES_SEND);

  return { at: lastPoll, pollMs: POLL_MS, windowMin: WINDOW_MIN, fastMin: FAST_MIN,
           minLive: MIN_LIVE, minFast: MIN_FAST, list: TICKERS, tickers: out, pollErrors,
           rate: RATE, series, alert: LEX.FEAR_ALERT, sampleMs: SAMPLE_MS };
}

// ── SSE ──────────────────────────────────────────────────────
// 폴링이 끝날 때만 밀어준다. 브라우저가 5초마다 되묻던 걸 없애서 지연이 폴링 주기만 남는다.
// 끊기면 EventSource 가 알아서 다시 붙으므로 재연결 코드는 없다.
const clients = new Set();
// 점 찍기는 보는 사람이 없어도 돌아야 한다 — 나중에 붙은 브라우저가 과거를 봐야 하기 때문이다.
// 그래서 clients 검사보다 sample() 이 먼저다.
function broadcast() {
  const snap = snapshot();
  sample(snap);
  if (!clients.size) return;
  const line = `data: ${JSON.stringify(snapshot())}\n\n`;   // 방금 찍은 점까지 담아 다시 만든다
  for (const res of clients) { try { res.write(line); } catch { clients.delete(res); } }
}

// ── 정적 서빙 ────────────────────────────────────────────────
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** 본문을 JSON 으로. 64KB 를 넘으면 끊는다 — 이 API 로 큰 걸 보낼 일이 없다. */
function readBody(req) {
  return new Promise((ok, no) => {
    let b = '';
    req.on('data', d => {
      b += d;
      if (b.length > 65536) { no(new Error('본문이 너무 큽니다.')); req.destroy(); }
    });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { no(new Error('JSON 형식이 아닙니다.')); } });
    req.on('error', no);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// 내보낼 파일을 이름으로 못박는다.
//
// 폴더를 통째로 서빙하면 data/*.posts.json(수십 MB의 긁어온 원문), 소스 전부,
// 그리고 나중에 누가 .env 를 만들면 그것까지 나간다. 경로 탈출만 막는 걸로는
// 부족하다 — 이 폴더 안에 이미 내보내면 안 되는 것들이 있기 때문이다.
// 원본 logo.png(1.1MB)는 안 내보낸다. 30px 로 쓰는데 1.1MB 를 받을 이유가 없다.
const PUBLIC = new Set(['live.html', 'index.html', 'data.js', 'lexicon.js', 'logo-128.png']);

function serveStatic(req, res) {
  const raw = decodeURIComponent(req.url.split('?')[0]);
  const rel = raw === '/' ? 'live.html' : raw.replace(/^\/+/, '');
  const file = normalize(join(HERE, rel));

  if (!PUBLIC.has(rel) || !file.startsWith(HERE) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('없는 경로입니다');
  }
  const img = /.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    // 이미지는 안 바뀐다. 나머지는 매번 새로 받아야 한다.
    'Cache-Control': img ? 'public, max-age=604800, immutable' : 'no-store',
  });
  res.end(readFileSync(file));
}

// ── 기동 ─────────────────────────────────────────────────────
console.log(`\n실시간 서버 · ${TICKERS.join(' ')}\n`);

for (const ticker of TICKERS) {
  const { code, name } = await resolveStock(ticker);
  LIVE.set(ticker, { code, name, posts: new Map(), price: null, error: null });
  console.log(`  ${ticker.padEnd(6)} ${name} (${code})`);
}

loadSeries();
const kept = TICKERS.reduce((a, t) => a + (SERIES.get(t)?.length ?? 0), 0);
if (kept) console.log(`  지난 계열 ${kept}점을 이어받았습니다 (data/series.json)`);

// Ctrl+C 로 끄면 마지막 20분치가 날아간다. 나가기 전에 한 번 쓴다.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { saveSeries(); process.exit(0); });
}

console.log(`\n  창 ${WINDOW_MIN}분 채우는 중… (종목당 최대 ${WARMUP_PAGES}페이지, 1~2분)`);
await pollAll(true);
// 앞선 폴링이 아직 안 끝났으면 건너뛴다. 겹치면 같은 글을 두 번 받고,
// 느린 구간에서 요청이 눈덩이처럼 쌓인다.
let polling = false, skipped = 0;
setInterval(() => {
  if (polling) {
    skipped++;
    if (skipped % 12 === 0) {
      process.stdout.write(`\n  폴링이 ${POLL_MS / 1000}초 안에 안 끝나 ${skipped}번 건너뛰었습니다.`
        + ` --poll 로 주기를 늘려보세요.\n`);
    }
    return;
  }
  polling = true;
  pollAll().catch(e => console.error('\n폴링 실패:', e.message)).finally(() => { polling = false; });
}, POLL_MS);

createServer((req, res) => {
  if (!authed(req, res)) return;              // 키 없으면 전부 404 — 있는지조차 안 알려준다

  const path = req.url.split('?')[0];

  if (path === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);   // 붙자마자 현재 상태 한 번
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // ── 종목 관리 ──
  if (path === '/api/tickers' && req.method === 'GET') {
    const list = loadTickers();
    const rows = list.map(t => ({
      t, name: LIVE.get(t)?.name ?? null,
      // 기준선이 있어야 지수가 나온다. 없으면 수집이 아직 안 끝난 것.
      baseline: !!SNAPSHOT?.[t]?.baseline?.wailCounts?.['min:60'],
      job: JOBS.get(t) ?? null,
    }));
    const n = list.length;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({
      rows, count: n, pollMs: POLL_MS,
      // 한 바퀴가 주기를 넘기면 회차를 건너뛴다. 미리 알려준다.
      lastPollMs: lastPollDur,
      crowded: lastPollDur !== null && lastPollDur > POLL_MS * 0.7,
    }));
  }

  if (path === '/api/tickers/resolve' && req.method === 'POST') {
    return readBody(req).then(async b => {
      const sym = String(b.symbol ?? '').trim().toUpperCase();
      if (!okSymbol(sym)) return sendJSON(res, 400, { error: '티커는 영숫자 1~12자입니다.' });
      try {
        const m = await resolveStock(sym);
        sendJSON(res, 200, { symbol: sym, name: m.name, code: m.code });
      } catch {
        sendJSON(res, 404, { error: `토스에서 ${sym} 을 찾지 못했습니다.` });
      }
    }).catch(e => sendJSON(res, 400, { error: e.message }));
  }

  if (path === '/api/tickers' && req.method === 'POST') {
    return readBody(req).then(async b => {
      try {
        const meta = await addTicker(b.symbol ?? b.base);
        sendJSON(res, 200, { ok: true, meta });
      } catch (e) { sendJSON(res, 400, { error: e.message }); }
    }).catch(e => sendJSON(res, 400, { error: e.message }));
  }

  if (path.startsWith('/api/tickers/') && req.method === 'DELETE') {
    const base = decodeURIComponent(path.slice('/api/tickers/'.length)).toUpperCase();
    try { removeTicker(base); return sendJSON(res, 200, { ok: true }); }
    catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }

  if (path === '/api/candles') {       // 봉 차트 (토스 프록시 + 캐시)
    const q = new URL(req.url, 'http://x').searchParams;
    const ticker = TICKERS.includes(q.get('t')) ? q.get('t') : TICKERS[0];
    const unit = UNITS[q.get('u')] ? q.get('u') : 'day:1';
    getBars(ticker, unit).then(rows => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      // 객체로 보내면 450개에 90KB 다. 배열로 보내면 25KB.
      res.end(JSON.stringify({ ticker, unit, units: UNITS,
        rows: rows.map(c => [c.ms, c.open, c.high, c.low, c.close, c.volume, c.session]) }));
    }).catch(e => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  if (path === '/api/fear') {          // 봉에 맞춘 과거 공포 강도
    const q = new URL(req.url, 'http://x').searchParams;
    const ticker = TICKERS.includes(q.get('t')) ? q.get('t') : TICKERS[0];
    const unit = UNITS[q.get('u')] ? q.get('u') : 'day:1';
    getBars(ticker, unit).then(bars => {
      const out = fearSeries(ticker, unit, bars.map(c => [c.ms]));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      // [시각, 공포글수, 전체글수, 지수]
      res.end(JSON.stringify({ ticker, unit, alert: LEX.FEAR_ALERT, ...out }));
    }).catch(e => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  if (path === '/api/posts') {         // 수집된 글 열람 (글 탭)
    let out;
    try {
      out = queryPosts(new URL(req.url, 'http://x').searchParams);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: e.message }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(out));
  }

  if (path === '/api/live') {          // curl 로 들여다볼 때 쓴다
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(snapshot()));
  }

  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`\n\n  이 링크로 여세요 (키가 붙어 있어야 열립니다)\n`);
  console.log(`    http://localhost:${PORT}/?k=${KEY}\n`);
  console.log(`  키 없이 들어오면 전부 404 입니다. 터널로 공개해도 링크를 아는 사람만 봅니다.`);
  console.log(`  키는 .access-key 에 있습니다. 유출되면 그 파일을 지우고 재시작하세요.`);
  console.log(`\n  ${POLL_MS / 1000}초마다 갱신(SSE 푸시). Ctrl+C 로 종료.\n`);
});
