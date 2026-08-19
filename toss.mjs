/**
 * 토스증권 웹이 쓰는 내부 API + 거래일 변환.
 * fetch-comments.mjs(수집)와 build.mjs(빌드)가 같이 쓴다.
 *
 * 전부 인증 없이 200이 온다. 문서화된 계약이 아니므로 언제든 바뀔 수 있다.
 * 공식 Open API(developers.tossinvest.com)에는 커뮤니티가 없고, 시세는 여기로도 되므로
 * client id/secret 은 이 프로젝트에 더 이상 필요 없다.
 */

const INFO = 'https://wts-info-api.tossinvest.com/api/v1';
const META = 'https://wts-info-api.tossinvest.com/api/v2/stock-infos';
const FEED = 'https://wts-cert-api.tossinvest.com/api/v4/comments';
const PRICE = 'https://wts-cert-api.tossinvest.com/api/v2/stock-prices';

// 차트 단위. 실측으로 확인한 것만 둔다 — minute:1 / hour:1 / min:240 은 400 이다.
// count 는 450 이 상한이고 그 위는 400 을 준다.
export const UNITS = {
  'min:1':  { label: '1분',  ms: 60_000,     cache: 20_000  },
  'min:10': { label: '10분', ms: 600_000,    cache: 60_000  },
  'min:60': { label: '60분', ms: 3_600_000,  cache: 180_000 },
  'day:1':  { label: '일',   ms: 86_400_000, cache: 600_000 },
};
export const MAX_COUNT = 450;

export const PAGE = 11;   // 게시글 페이지 크기. 서버 고정 — size/limit/count/pageSize 전부 무시된다

export const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${new URL(url).pathname} 실패 (HTTP ${res.status})\n${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
}

// ── 거래일 변환 ──────────────────────────────────────────────
// 게시글 createdAt 은 KST(+09:00), 캔들 dt 는 미 동부시각(-04:00/-05:00)이다.
// 그대로 KST 달력으로 묶으면 미국장(KST 22:30~05:00) 한 세션이 이틀로 쪼개져
// 시차 상관에서 ±1일에 가짜 신호가 생긴다. 그래서 게시글도 미 동부 날짜로 맞춘다.
//
// Intl 이 서머타임을 알아서 처리한다. 직접 -4/-5 를 더하면 3월·11월 전환 주에 하루씩 틀어진다.
const ET_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const OPEN_MIN = 9 * 60 + 30;   // 09:30 ET
const CLOSE_MIN = 16 * 60;      // 16:00 ET

/** ISO 문자열 → { date: 'YYYY-MM-DD'(미 동부), min: 자정부터의 분, intraday: 정규장 여부 } */
export function et(iso) {
  const p = {};
  for (const x of ET_FMT.formatToParts(new Date(iso))) p[x.type] = x.value;
  const min = +p.hour * 60 + +p.minute;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    min,
    intraday: min >= OPEN_MIN && min < CLOSE_MIN,
  };
}

// ── 종목 ─────────────────────────────────────────────────────
/** 티커 → { code, name, symbol }. SNDK → NAS0250224006 */
export async function resolveStock(ticker) {
  const j = await getJSON(`${META}/code-or-symbol/${encodeURIComponent(ticker)}`);
  const r = j.result ?? j;
  const code = r?.code ?? r?.stockCode;
  if (!code) throw new Error(`'${ticker}' 의 종목코드를 찾지 못했습니다. 티커를 확인하세요.`);
  return { code, name: r.name || r.englishName || ticker, symbol: r.symbol || ticker };
}

// ── 일봉 ─────────────────────────────────────────────────────
// count 를 크게 줘도 한 번에 온다(300 확인). to= 는 무시되므로 페이징은 없다.
// dt 가 이미 미 동부 날짜라 앞 10자를 그대로 쓴다.
/**
 * 임의 단위의 봉. 일봉과 달리 `dt` 를 그대로 들고 온다 — 분봉은 날짜만으론 못 가른다.
 * 응답은 최신순이라 뒤집어서 오래된 순으로 준다(차트가 왼쪽부터 그린다).
 */
export async function fetchBars(code, unit = 'day:1', count = MAX_COUNT) {
  if (!UNITS[unit]) throw new Error(`모르는 단위입니다: ${unit}`);
  const n = Math.min(MAX_COUNT, Math.max(1, count | 0));
  for (const seg of ['us-s', 'kr-s']) {
    try {
      const j = await getJSON(`${INFO}/c-chart/${seg}/${code}/${unit}?count=${n}&useAdjustedRate=true`);
      const candles = j.result?.candles ?? [];
      if (candles.length) {
        return candles
          .map(c => ({
            ms: Date.parse(c.dt), dt: c.dt,
            open: +c.open, high: +c.high, low: +c.low, close: +c.close,
            volume: +c.volume, session: c.sessionType ?? null,
          }))
          .filter(c => Number.isFinite(c.ms) && Number.isFinite(c.close))
          .sort((a, b) => a.ms - b.ms);
      }
    } catch { /* 다음 세그먼트로 */ }
  }
  throw new Error(`${code} 의 ${unit} 봉을 받지 못했습니다.`);
}

export async function fetchCandles(code, count = 300) {
  for (const seg of ['us-s', 'kr-s']) {
    try {
      const j = await getJSON(`${INFO}/c-chart/${seg}/${code}/day:1?count=${count}&useAdjustedRate=true`);
      const candles = j.result?.candles ?? [];
      if (candles.length) {
        // 응답에는 open/high/low/volume 이 원래 다 들어있다. 캔들을 그리려면 필요하다.
        return candles
          .map(c => ({
            date: String(c.dt).slice(0, 10),
            open: +c.open, high: +c.high, low: +c.low, close: +c.close,
            volume: +c.volume,
          }))
          .filter(c => Number.isFinite(c.close))
          .sort((a, b) => (a.date < b.date ? -1 : 1));
      }
    } catch { /* 다음 세그먼트로 */ }
  }
  throw new Error(`${code} 의 일봉을 받지 못했습니다.`);
}

// ── 환율 ─────────────────────────────────────────────────────
/** USD → KRW. 토스가 시세 환산에 쓰는 것과 같은 값이다. */
export async function fetchRate() {
  const j = await getJSON('https://wts-api.tossinvest.com/api/v1/exchange/usd/base-exchange-rate');
  const r = j.result ?? j;
  const rate = +(r.rate ?? r.usdMidRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('환율을 읽지 못했습니다.');
  return { rate, baseDate: r.baseDate ?? null };
}

// ── 현재가 ───────────────────────────────────────────────────
/** 실시간 시세 한 건. { close, open, high, low, volume, at } */
export async function fetchPrice(code) {
  const j = await getJSON(`${PRICE}/${encodeURIComponent(code)}`);
  const r = j.result ?? j;
  return {
    close: +r.close, open: +r.open, high: +r.high, low: +r.low,
    volume: +r.volume, at: r.tradeDateTime ?? null,
  };
}

/**
 * 최신 게시글 한 페이지(11건). 실시간 폴링용.
 * cursor 를 주면 그보다 오래된 쪽으로 넘어간다. { posts, key, hasNext } 를 돌려준다.
 *
 * 커서가 필요한 이유: 폴링 간격 사이에 11건 넘게 올라오면 그냥 맨 앞만 봐서는 놓친다.
 * 공포가 치솟는 순간이 정확히 글이 폭주하는 순간이라, 하필 그때 표본을 잃는다.
 */
export async function fetchLatest(code, cursor = null) {
  const j = await getJSON(`${FEED}?subjectType=STOCK&subjectId=${encodeURIComponent(code)}`
    + `&commentSortType=RECENT${cursor == null ? '' : `&lastCommentId=${cursor}`}`);
  const r = j.result ?? {};
  const posts = (r.results ?? [])
    .filter(c => c.type === 'USER_COMMENT')
    .map(c => ({
      id: c.commentId,
      at: String(c.createdAt),
      text: [c.message?.title, c.message?.message].filter(Boolean).join(' ').trim(),
      likes: c.statistic?.likeCount ?? 0,
    }))
    .filter(p => p.text);
  return { posts, key: r.key ?? null, hasNext: !!r.hasNext };
}

// ── 커뮤니티 게시글 ──────────────────────────────────────────
/**
 * cutoff(미 동부 날짜 문자열)보다 오래된 글이 나올 때까지 거슬러 올라간다.
 *
 * stopOnSeen 이 참이면 이미 받은 글을 만나는 순간 멈춘다(증분). 이건 기존 데이터가
 * cutoff 까지 이미 닿아 있을 때만 안전하다. 안 그러면 최근 며칠치만 있는 상태에서
 * 첫 중복을 만나 즉시 멈춰버려, 기간을 늘려도 데이터가 안 늘어난다.
 * 그 경우 stopOnSeen=false 로 두면 중복은 건너뛰고 cutoff 까지 계속 판다.
 *
 * onProgress(pages, count) 로 진행 상황을 흘려보낸다.
 */
export async function fetchComments(code, cutoff, seen,
    { delay = 80, hardCap = 20000, stopOnSeen = true, onProgress } = {}) {
  const base = `${FEED}?subjectType=STOCK&subjectId=${encodeURIComponent(code)}&commentSortType=RECENT`;
  const out = [];
  let cursor = null, pages = 0, stop = null;

  while (pages < hardCap) {
    const j = await getJSON(base + (cursor == null ? '' : `&lastCommentId=${cursor}`));
    const r = j.result;
    const rows = r?.results ?? [];
    if (!rows.length) { stop = '더 받을 글이 없습니다'; break; }

    for (const c of rows) {
      // 공시·뉴스 카드 등 자동 생성물은 감정 표본이 아니다
      if (c.type !== 'USER_COMMENT') continue;
      if (seen.has(c.commentId)) {
        if (stopOnSeen) { stop = '이미 받은 글에 도달 (증분)'; break; }
        continue;                                  // 아직 cutoff 에 못 닿았다 — 건너뛰고 더 판다
      }
      const at = String(c.createdAt);
      if (et(at).date < cutoff) { stop = '기간 경계 도달'; break; }
      // 리포스트 본문은 남의 글이므로 본인이 쓴 말만 센다
      const text = [c.message?.title, c.message?.message].filter(Boolean).join(' ').trim();
      if (!text) continue;
      out.push({ id: c.commentId, at, text, likes: c.statistic?.likeCount ?? 0 });
    }
    pages++;
    if (stop) break;
    if (!r.hasNext) { stop = '마지막 페이지'; break; }
    if (r.key === cursor) { stop = '커서가 더 안 움직입니다'; break; }   // 서버 변경 시 무한루프 방지
    cursor = r.key;

    onProgress?.(pages, out.length);
    await sleep(delay);
  }
  if (pages >= hardCap) stop = `${hardCap}페이지 상한에 걸려 중단 — 그 이전 기간은 빠져 있습니다`;
  return { posts: out, pages, stop };
}
