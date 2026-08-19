import { run, ok, summary } from './test-app.mjs';

// ── 픽스처 ────────────────────────────────────────────────
// 미국 거래일(평일)만 단조 증가로 만든다.
function tradingDates(n, startUTC = Date.UTC(2026, 4, 4)) {   // 월요일
  const out = [];
  const d = new Date(startUTC);
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** days 배열 만들기. fn(i, date) → { close, posts, sentiment, postsIntra, sentimentIntra } */
const mkDays = (dates, fn) => dates.map((date, i) => ({ date, ...fn(i, date) }));

const flat = (i) => ({
  close: +(40 + Math.sin(i / 3) * 5).toFixed(2),
  posts: 0, sentiment: null, postsIntra: 0, sentimentIntra: null,
  fear: null, fearIntra: null,
});

/** 감정이 있는 평범한 종목 */
const noisy = (seed) => (i) => {
  const s = +(Math.sin(i * seed) * 0.6).toFixed(3);
  return {
    close: +(40 + Math.cos(i / 4) * 6).toFixed(2),
    posts: 20, sentiment: s,
    postsIntra: 12, sentimentIntra: +(s * 0.8).toFixed(3),
    fear: +(0.05 + Math.abs(Math.sin(i * seed)) * 0.04).toFixed(4),
    fearIntra: 0.04,
  };
};

const mkData = (tickers, pairs, rate = { rate: 1400, baseDate: '2026-08-14' }) => ({
  builtAt: '2026-08-14T00:00:00Z', days: 30, pairs, rate, tickers,
});

const pair2 = (baseDays, levDays) => mkData({
  SNDK: { name: '샌디스크', code: 'NAS0250224006', days: baseDays },
  SNXX: { name: 'SNXX', code: 'AMX0260127004', days: levDays },
}, [['SNDK', 'SNXX']]);

// ══════════════════════════════════════════════════════════
console.log('\n── A. data.js 없음 ──');
{
  const { txt } = run(null);
  ok('배너가 안내를 띄움', txt('banner').includes('data.js'));
  ok('빌드 명령을 알려줌', txt('banner').includes('build.mjs'));
}

console.log('\n── B. 쌍 기본 동작 ──');
{
  const dates = tradingDates(40);
  const { X, txt } = run(pair2(mkDays(dates, noisy(0.7)), mkDays(dates, noisy(1.1))));
  ok('두 종목 모두 행 생성', X.ROWS.SNDK.length === 40 && X.ROWS.SNXX.length === 40);
  ok('날짜 축 공유', X.DATES.length === 40 && X.DATES[0] === dates[0]);
  ok('두 종목 날짜가 인덱스로 맞물림',
     X.ROWS.SNDK.every((r, i) => r.date === X.ROWS.SNXX[i].date));
  ok('첫 수익률 0', X.ROWS.SNDK[0].ret === 0);
  ok('NaN 없음', !X.ROWS.SNDK.some(r => isNaN(r.close) || isNaN(r.ret)));
  ok('조합 4개', X.series().length === 4);
  ok('셀 4×9=36개', X.CELLS.length === 36, `got ${X.CELLS.length}`);
  ok('셀에 교차 조합이 들어 있음',
     X.CELLS.some(c => c.s === 'SNXX' && c.p === 'SNDK') &&
     X.CELLS.some(c => c.s === 'SNDK' && c.p === 'SNXX'));
  ok('배너=실데이터', txt('banner').includes('실데이터'));
}

console.log('\n── C. 교차 시차 상관이 맞는 시차를 찾는가 ──');
{
  // SNXX 감정이 SNDK 수익률을 정확히 1일 선행하도록 만든다.
  // ret[i+1] = 0.02 * sentiment[i]  →  (SNXX감정 → SNDK주가, +1) 의 상관이 1 이어야 한다.
  const dates = tradingDates(50);
  const sent = dates.map((_, i) => +(Math.sin(i * 0.9) * 0.7).toFixed(4));

  const levDays = mkDays(dates, i => ({
    close: 20, posts: 30, sentiment: sent[i], postsIntra: 30, sentimentIntra: sent[i],
  }));

  const closes = [100];
  for (let i = 1; i < dates.length; i++) closes.push(closes[i-1] * (1 + 0.02 * sent[i-1]));
  const baseDays = mkDays(dates, i => ({
    close: +closes[i].toFixed(4), posts: 30, sentiment: 0.1,   // 본주 감정은 상수 → 분산 0
    postsIntra: 30, sentimentIntra: 0.1,
  }));

  const { X } = run(pair2(baseDays, levDays));
  const cell = X.CELLS.find(c => c.s === 'SNXX' && c.p === 'SNDK' && c.lag === 1);
  ok('SNXX감정→SNDK주가 +1일 = 1.00', Math.abs(cell.r - 1) < 1e-6, `r=${cell.r}`);

  const other = X.CELLS.find(c => c.s === 'SNXX' && c.p === 'SNDK' && c.lag === 0);
  ok('시차 0 은 그보다 약함', Math.abs(other.r) < Math.abs(cell.r), `r0=${other.r}`);

  ok('BEST 가 그 칸을 집음',
     X.BEST.s === 'SNXX' && X.BEST.p === 'SNDK' && X.BEST.lag === 1,
     JSON.stringify(X.BEST));
  ok('BEST_REAL 참', X.BEST_REAL === true);
  ok('본주 감정은 분산 0 이라 NaN',
     X.CELLS.filter(c => c.s === 'SNDK').every(c => isNaN(c.r)));
}

console.log('\n── D. 음수 시차(주가가 먼저)도 잡히는가 ──');
{
  // 감정[i] 이 수익률[i-2] 를 그대로 베낀다 → 시차 -2 에서 상관 1
  const dates = tradingDates(50);
  const rets = dates.map((_, i) => +(Math.sin(i * 0.8) * 0.03).toFixed(5));
  const closes = [100];
  for (let i = 1; i < dates.length; i++) closes.push(closes[i-1] * (1 + rets[i]));

  const baseDays = mkDays(dates, i => ({
    close: +closes[i].toFixed(4),
    posts: 30, sentiment: rets[i-2] !== undefined ? +(rets[i-2] * 20).toFixed(4) : 0,
    postsIntra: 30, sentimentIntra: 0,
  }));
  const levDays = mkDays(dates, flat);

  const { X } = run(mkData({
    SNDK: { name: '샌디스크', code: 'X', days: baseDays },
  }, [['SNDK', null]]));

  const cell = X.CELLS.find(c => c.lag === -2);
  ok('시차 -2 에서 상관 1', Math.abs(cell.r - 1) < 1e-6, `r=${cell.r}`);
  ok('BEST 가 음수 시차', X.BEST.lag === -2, JSON.stringify(X.BEST));
  void levDays;
}

console.log('\n── E. 짝 없는 종목 (KORU) ──');
{
  const dates = tradingDates(30);
  const { X } = run(mkData({
    KORU: { name: 'KORU', code: 'US20130410003', days: mkDays(dates, noisy(0.5)) },
  }, [['KORU', null]]));
  ok('종목 1개만', X.pairTickers().length === 1);
  ok('조합 1개', X.series().length === 1);
  ok('셀 9개', X.CELLS.length === 9, `got ${X.CELLS.length}`);
  ok('자기 감정 → 자기 주가', X.CELLS[0].s === 'KORU' && X.CELLS[0].p === 'KORU');
  ok('레버리지 아님', X.isLev('KORU') === false);
}

console.log('\n── F. 장중 필터 ──');
{
  const dates = tradingDates(30);
  const days = mkDays(dates, i => ({
    close: 50 + i,
    posts: 100, sentiment: 0.5,
    postsIntra: 10, sentimentIntra: -0.5,      // 장중만 보면 부호가 뒤집히도록
  }));
  const data = mkData({ KORU: { name: 'KORU', code: 'X', days } }, [['KORU', null]]);

  const a = run(data);
  ok('기본은 전체 표본', a.X.ROWS.KORU[0].posts === 100 && a.X.ROWS.KORU[0].sentiment === 0.5);

  const b = run(data, x => { x.UI.intraday = true; });
  ok('장중 켜면 장중 표본', b.X.ROWS.KORU[0].posts === 10 && b.X.ROWS.KORU[0].sentiment === -0.5);
  ok('배너에 장중 표시', b.node('banner').innerHTML.includes('장중'));

  // 장중 게시글이 0인 날은 감정도 없어야 한다
  const noIntra = mkDays(dates, i => ({
    close: 50 + i, posts: 40, sentiment: 0.3, postsIntra: 0, sentimentIntra: null,
  }));
  const c = run(mkData({ KORU: { name: 'KORU', code: 'X', days: noIntra } }, [['KORU', null]]),
                x => { x.UI.intraday = true; });
  ok('장중 글 없는 날은 usable 아님', c.X.ROWS.KORU.every(r => !r.usable));
  ok('그 경우 BEST 없음', c.X.BEST === null);
}

console.log('\n── G. 기간 · 최소 게시글 · 가중 ──');
{
  const dates = tradingDates(80);
  const days = mkDays(dates, i => {
    const s = +(Math.sin(i * 0.7) * 0.6).toFixed(3);
    return {
      close: +(40 + Math.cos(i / 4) * 6).toFixed(2),
      posts: i % 10 === 0 ? 1 : 8,             // 10일마다 표본 1건짜리 날
      sentiment: s, postsIntra: 4, sentimentIntra: s,
    };
  });
  const data = mkData({ KORU: { name: 'KORU', code: 'X', days } }, [['KORU', null]]);

  const all = run(data);
  ok('기본 전체 기간', all.X.DATES.length === 80, `got ${all.X.DATES.length}`);
  const usableAll = all.X.ROWS.KORU.filter(r => r.usable).length;

  const r30 = run(data, x => { x.UI.range = '30'; });
  ok('기간 30일 필터', r30.X.DATES.length === 30, `got ${r30.X.DATES.length}`);
  ok('필터 후 첫 수익률 0', r30.X.ROWS.KORU[0].ret === 0);
  ok('필터 후 수익률 재계산됨',
     r30.X.ROWS.KORU[1].ret !== all.X.ROWS.KORU[1].ret ||
     r30.X.ROWS.KORU[1].date !== all.X.ROWS.KORU[1].date);

  const r5 = run(data, x => { x.UI.minPosts = 5; });
  const usable5 = r5.X.ROWS.KORU.filter(r => r.usable).length;
  ok('최소 게시글이 표본 걸러냄', usable5 < usableAll, `${usable5} < ${usableAll}`);
  ok('제외돼도 감정값은 남음', r5.X.ROWS.KORU.some(r => r.sentiment !== null && !r.usable));

  const rw = run(data, x => { x.UI.weighted = true; });
  ok('가중 모드에서 상관 계산됨', rw.X.CELLS.some(c => !isNaN(c.r)));
}

console.log('\n── H. 잡음 문턱 ──');
{
  const dates = tradingDates(60);
  const { X } = run(mkData({
    KORU: { name: 'KORU', code: 'X', days: mkDays(dates, noisy(0.9)) },
  }, [['KORU', null]]));
  ok('NOISE 양수·1 미만', X.NOISE > 0 && X.NOISE < 1, `${X.NOISE}`);
  ok('BEST_REAL 은 문턱 초과일 때만',
     X.BEST_REAL === (!!X.BEST && Math.abs(X.BEST.r) > X.NOISE));
  ok('표본이 많을수록 문턱이 낮다', X.NOISE < 2 / Math.sqrt(4));
}

console.log('\n── I. 경계 ──');
{
  const one = tradingDates(1);
  let r = run(mkData({ KORU: { name:'K', code:'X', days: mkDays(one, flat) } }, [['KORU', null]]));
  ok('1행: 예외 없음', r.X.DATES.length === 1);
  ok('1행: BEST 없음', r.X.BEST === null);

  r = run(mkData({ KORU: { name:'K', code:'X', days: [] } }, [['KORU', null]]));
  ok('0행: 예외 없음', r.X.DATES.length === 0);
  ok('0행: 셀 전부 NaN', r.X.CELLS.every(c => isNaN(c.r)));

  const d40 = tradingDates(40);
  r = run(mkData({ KORU: { name:'K', code:'X', days: mkDays(d40, flat) } }, [['KORU', null]]));
  ok('감정 전무: 예외 없음', r.X.DATES.length === 40);
  ok('감정 전무: 전부 null', r.X.ROWS.KORU.every(x => x.sentiment === null));
  ok('감정 전무: BEST 없음', r.X.BEST === null);
  ok('감정 전무: 배너가 수집을 안내', r.node('banner').innerHTML.includes('fetch-comments'));

  // 감정이 전부 같은 값 → 분산 0 → NaN
  const d20 = tradingDates(20);
  r = run(mkData({ KORU: { name:'K', code:'X',
    days: mkDays(d20, i => ({ close: 30 + i, posts: 9, sentiment: 0.4,
                              postsIntra: 9, sentimentIntra: 0.4 })) } }, [['KORU', null]]));
  ok('분산 0: 예외 없음 + 전부 NaN', r.X.CELLS.every(c => isNaN(c.r)));
  ok('분산 0: BEST 없음', r.X.BEST === null);
}

console.log('\n── J. 쌍 전환 ──');
{
  const dates = tradingDates(30);
  const data = mkData({
    SNDK: { name:'샌디스크', code:'A', days: mkDays(dates, noisy(0.7)) },
    SNXX: { name:'SNXX',   code:'B', days: mkDays(dates, noisy(1.1)) },
    KORU: { name:'KORU',   code:'C', days: mkDays(dates, noisy(0.5)) },
  }, [['SNDK','SNXX'], ['KORU', null]]);

  const a = run(data);
  ok('첫 쌍은 SNDK/SNXX', a.X.pairTickers().join() === 'SNDK,SNXX');
  ok('SNXX 는 레버리지', a.X.isLev('SNXX') === true && a.X.isLev('SNDK') === false);

  const b = run(data, x => { x.UI.pair = 1; });
  ok('전환하면 KORU 단독', b.X.pairTickers().join() === 'KORU');
  ok('전환 후 셀 9개', b.X.CELLS.length === 9, `got ${b.X.CELLS.length}`);
  ok('전환 후 이전 종목 행 없음', b.X.ROWS.SNDK === undefined);
}

console.log('\n── K. 공포 비율 ──');
{
  const dates = tradingDates(30);
  const days = mkDays(dates, i => ({
    close: 50 + i, posts: 100, sentiment: 0.2,
    postsIntra: 40, sentimentIntra: 0.1,
    fear: 0.08, fearIntra: 0.03,
  }));
  const data = mkData({ KORU: { name: 'KORU', code: 'X', days } }, [['KORU', null]]);

  const a = run(data);
  ok('전체 창의 공포 비율', a.X.ROWS.KORU[0].fear === 0.08);

  const b = run(data, x => { x.UI.intraday = true; });
  ok('장중 켜면 장중 공포 비율', b.X.ROWS.KORU[0].fear === 0.03);

  // 공포는 감정과 독립이다 — 감정이 없어도 공포 값은 실려야 한다
  const noSent = mkDays(dates, i => ({
    close: 50 + i, posts: 0, sentiment: null, postsIntra: 0, sentimentIntra: null,
    fear: null, fearIntra: null,
  }));
  const c = run(mkData({ KORU: { name:'KORU', code:'X', days: noSent } }, [['KORU', null]]));
  ok('감정 없으면 공포도 null', c.X.ROWS.KORU.every(r => r.fear === null));
  ok('그래도 예외 없이 렌더', c.X.DATES.length === 30);

  // 예전 data.js (공포 필드 없음) 로도 죽지 않아야 한다
  const old = dates.map((date, i) => ({ date, close: 50 + i, posts: 10, sentiment: 0.1,
                                        postsIntra: 5, sentimentIntra: 0.1 }));
  const d = run(mkData({ KORU: { name:'KORU', code:'X', days: old } }, [['KORU', null]]));
  ok('공포 필드 없는 옛 데이터도 렌더됨', d.X.DATES.length === 30);
  ok('그 경우 공포는 null', d.X.ROWS.KORU.every(r => r.fear === null));
}

console.log('\n── L. 통화 전환 ──');
{
  const dates = tradingDates(10);
  const days = mkDays(dates, i => ({
    close: 100, posts: 10, sentiment: 0.1, postsIntra: 5, sentimentIntra: 0.1,
    fear: 0.05, fearIntra: 0.05,
  }));
  const data = mkData({ KORU: { name: 'KORU', code: 'X', days } }, [['KORU', null]]);

  const usd = run(data);
  ok('기본은 USD', usd.X.money(100) === '$100.00', usd.X.money(100));
  ok('축 눈금도 USD', usd.X.axisMoney(100) === '100', usd.X.axisMoney(100));

  const krw = run(data, x => { x.UI.cur = 'KRW'; });
  ok('원화로 환산', krw.X.money(100) === '₩140,000', krw.X.money(100));
  ok('환산해도 수익률은 그대로', krw.X.ROWS.KORU[5].ret === usd.X.ROWS.KORU[5].ret);
  ok('축 눈금은 줄여 쓴다', /만/.test(krw.X.axisMoney(140000)), krw.X.axisMoney(140000));

  // 환율이 없으면 원화로 못 간다
  const noRate = run(mkData({ KORU: { name:'KORU', code:'X', days } }, [['KORU', null]], null),
                     x => { x.UI.cur = 'KRW'; });
  ok('환율 없으면 —', noRate.X.money(100) === '—', noRate.X.money(100));
  ok('그래도 예외 없이 렌더', noRate.X.DATES.length === 10);
}


console.log('\n── M. 공포지수 ──');
{
  const dates = tradingDates(10);
  // 전체 기준선 5%±1%p, 장중 기준선 3%±1%p — 토글이 기준선까지 바꾸는지 보려고 일부러 다르게 잡는다
  const bl = { hourly: {}, overall: null,
               daily: { all: { mean: 0.05, sd: 0.01, n: 10 }, intra: { mean: 0.03, sd: 0.01, n: 10 } } };
  const days = mkDays(dates, i => ({
    close: 100, posts: 100, sentiment: 0.1, postsIntra: 100, sentimentIntra: 0.1,
    fear: i === 0 ? 0.05 : i === 1 ? 0.07 : i === 2 ? 0.03 : 0.05,
    fearIntra: 0.03,
  }));
  const withBase = tk => mkData({ KORU: { name: 'KORU', code: 'X', days, baseline: bl } }, [['KORU', null]]);

  const a = run(withBase());
  const R = a.X.ROWS.KORU;
  ok('평소 비율이면 50', R[0].fearIdx === 50, String(R[0].fearIdx));
  ok('2 표준편차 위면 90 (경보선)', R[1].fearIdx === 90, String(R[1].fearIdx));
  ok('2 표준편차 아래면 10', Math.abs(R[2].fearIdx - 10) < 1e-9, String(R[2].fearIdx));
  ok('경보선은 lexicon.js 값을 그대로 쓴다', a.X.ALERT === 90, String(a.X.ALERT));

  // 장중 토글은 비율과 기준선을 같이 바꿔야 한다.
  // 장중 비율 3% 를 전체 기준선(5%)에 대면 지수가 10 으로 떨어져 없는 '평온'이 보인다.
  const b = run(withBase(), x => { x.UI.intraday = true; });
  ok('장중은 장중 기준선과 짝짓는다', b.X.ROWS.KORU[0].fearIdx === 50,
     String(b.X.ROWS.KORU[0].fearIdx));

  // 기준선이 없는 data.js (예전 빌드) 로도 죽지 않아야 한다
  const c = run(mkData({ KORU: { name: 'KORU', code: 'X', days } }, [['KORU', null]]));
  ok('기준선 없으면 지수도 없음', c.X.ROWS.KORU.every(r => r.fearIdx === null));
  ok('그래도 예외 없이 렌더', c.X.DATES.length === 10);

  // 표준편차가 0 이면 z 가 무한대가 된다 — 지수를 내면 안 된다
  const flatBl = { hourly: {}, overall: null, daily: { all: { mean: 0.05, sd: 0, n: 10 }, intra: null } };
  const d = run(mkData({ KORU: { name: 'KORU', code: 'X', days, baseline: flatBl } }, [['KORU', null]]));
  ok('표준편차 0 이면 지수 없음', d.X.ROWS.KORU.every(r => r.fearIdx === null));

  // 표는 이 탭에 남은 유일한 화면이다
  ok('표 머리에 공포지수 열', a.node('sel:#tbl thead').innerHTML.includes('공포지수'));
}


summary();
