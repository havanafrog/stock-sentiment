// live.html — 실시간 그래프 그리기 검사.
// index.html 쪽은 run-tests.mjs 가 본다.
import { run, pathOf } from './test-live.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

const T0 = Date.UTC(2026, 7, 19, 12, 0, 0);
const at = i => T0 + i * 60_000;
/** 값 배열 → [[ms, 값], ...] */
const pts = vals => vals.map((v, i) => [at(i), v]);

const FEAR = { color: 'red', fmt: v => v.toFixed(0), lo: 0, hi: 100 };

console.log('\n── A. 선 그리기 ──');
{
  const { L, node } = run();
  ok('점이 두 개면 그린다', L.spark('cFear', pts([50, 60]), FEAR) === true);
  ok('점이 하나면 안 그린다', L.spark('cFear', pts([50]), FEAR) === false);
  ok('점이 없으면 안 그린다', L.spark('cFear', [], FEAR) === false);
  ok('전부 null 이면 안 그린다', L.spark('cFear', pts([null, null, null]), FEAR) === false);

  L.spark('cFear', pts([50, 60, 70]), FEAR);
  const d = pathOf('cFear', node);
  ok('점 수만큼 꼭짓점', (d.match(/[ML]/g) || []).length === 3, d);
  ok('첫 점은 M', d.startsWith('M'), d);
}

console.log('\n── B. 값이 빈 구간 ──');
{
  const { L, node } = run();
  // 표본 부족·창 채우는 중이면 서버가 null 을 보낸다. 그 구간을 이어 그리면
  // 없는 값을 지어내는 셈이라, 선을 끊어야 한다.
  L.spark('cFear', pts([50, 60, null, null, 80, 90]), FEAR);
  const d = pathOf('cFear', node);
  ok('빈 구간에서 선이 끊긴다', (d.match(/M/g) || []).length === 2, d);
  ok('실제 값 개수만큼만 찍힌다', (d.match(/[ML]/g) || []).length === 4, d);

  L.spark('cFear', pts([null, 50, 60]), FEAR);
  ok('앞이 비어 있어도 그린다', pathOf('cFear', node).startsWith('M'));

  // 값이 하나뿐이면 이을 데가 없다
  ok('값이 하나면 안 그린다', L.spark('cFear', pts([null, 50, null]), FEAR) === false);
}

console.log('\n── C. 눈금 범위 ──');
{
  const { L, node } = run();
  // 공포지수는 0~100 고정이라 값이 조금 움직여도 눈금이 안 흔들려야 한다
  L.spark('cFear', pts([50, 51, 52]), FEAR);
  const ticks = node('cFear').children.filter(c => c.textContent !== '' && c._attrs.class === 'ctk');
  ok('고정 범위면 눈금이 0·50·100', ticks.slice(0, 3).map(t => t.textContent).join() === '0,50,100',
     ticks.map(t => t.textContent).join());

  // 값이 완전히 평평하면 (hi-lo) 가 0 이라 0 으로 나눈다 — 벌려 줘야 한다
  const flat = L.spark('cPrice', pts([100, 100, 100]), { color: 'b', fmt: v => v.toFixed(1) });
  ok('평평해도 그린다', flat === true);
  ok('평평한 선에 NaN 이 없다', !/NaN/.test(pathOf('cPrice', node) ?? ''), pathOf('cPrice', node));

  // 0 도 평평할 수 있다 (가격이 0 일 리는 없지만 방어)
  run();
  ok('0 으로 평평해도 NaN 없음',
     (() => { const r = run(); r.L.spark('cPrice', pts([0, 0]), { color: 'b', fmt: v => v.toFixed(1) });
              return !/NaN/.test(pathOf('cPrice', r.node) ?? 'NaN'); })());
}

console.log('\n── D. 경보선 ──');
{
  const { L, node } = run();
  L.spark('cFear', pts([50, 60]), { ...FEAR, lines: [{ v: 50, color: 'g' }, { v: 90, color: 'r' }] });
  const dashed = node('cFear').children.filter(c => c._attrs['stroke-dasharray']);
  ok('기준선 두 개를 긋는다', dashed.length === 2, String(dashed.length));

  const { L: L2, node: n2 } = run();
  // 범위 밖 기준선은 칸 밖에 그려져 어긋난다 — 아예 안 그린다
  L2.spark('cFear', pts([50, 60]), { ...FEAR, lines: [{ v: 200, color: 'r' }] });
  ok('범위 밖 기준선은 안 긋는다',
     n2('cFear').children.filter(c => c._attrs['stroke-dasharray']).length === 0);
}

console.log('\n── E. 통화 전환 ──');
{
  const { L } = run();
  ok('기본은 달러 그대로', L.cur(100) === 100);
  L.UI.cur = 'KRW';
  ok('환율이 없으면 안 바꾼다 (선이 사라지는 것보다 낫다)', L.cur(100) === 100);
  ok('원화 축 눈금은 줄여 쓴다', /만|천/.test(L.moneyShort(1400000)), L.moneyShort(1400000));
  L.UI.cur = 'USD';
  ok('달러 축 눈금은 소수 한 자리', L.moneyShort(12.34) === '12.3', L.moneyShort(12.34));
  ok('네 자리 넘으면 정수', L.moneyShort(1625.78) === '1626', L.moneyShort(1625.78));
}

console.log('\n── F. paint 전체 ──');
{
  const { L, node } = run();
  // 공포지수는 이제 SSE 계열이 아니라 /api/fear 가 봉 격자에 맞춰 준다.
  L.BAR.rows = Array.from({ length: 5 }, (_, i) =>
    [at(i), 100, 110, 90, 100 + i, 10, 'day']);
  L.BAR.fear = L.BAR.rows.map((r, i) => [r[0], i, i * 10, 40 + i * 10]);
  L.paint({
    at: new Date(T0).toISOString(), pollMs: 15000, windowMin: 60, fastMin: 15,
    minLive: 20, minFast: 10, pairs: [['SNDK', null]], pollErrors: 0, rate: null,
    alert: 90, sampleMs: 60000, series: {},
    tickers: { SNDK: {
      name: '샌디스크', price: { close: 104 }, error: null, spanMin: 60, warming: false,
      w60: { n: 100, fear: 0.05, fearN: 5, sentiment: 0.1, idx: 62, base: 3.1, baseSd: 2.2, baseN: 23, thin: false },
      w15: { n: 30, fear: 0.05, sentiment: 0.1, thin: false },
      recent: [],
    } },
  });
  ok('공포지수 선을 그렸다', (pathOf('cFear', node) ?? '').startsWith('M'));
  ok('현재 공포지수를 띄운다', node('cNowF').textContent === '80', node('cNowF').textContent);
  ok('현재가를 띄운다', node('cNowP').textContent === '$104.00', node('cNowP').textContent);

  // 글이 없는 구간은 지수가 null 이라 선이 끊겨야 한다
  const r2 = run();
  r2.L.BAR.rows = Array.from({ length: 6 }, (_, i) => [at(i), 100, 110, 90, 100, 10, 'day']);
  r2.L.BAR.fear = [[at(0), 1, 10, 40], [at(1), 2, 20, 60], [at(2), 0, 0, null],
                   [at(3), 0, 0, null], [at(4), 3, 30, 70], [at(5), 4, 40, 80]];
  r2.L.drawFear();
  const d = pathOf('cFear', r2.node);
  ok('값 없는 구간에서 끊긴다', (d.match(/M/g) || []).length === 2, d);

  // 수집 시점을 알려준다
  r2.L.BAR.covers = Date.UTC(2026, 7, 14);
  r2.L.drawFear();
  ok('글이 어디까지인지 적는다', /글은 .* 까지/.test(r2.node('cFearNote').textContent),
     r2.node('cFearNote').textContent);
  ok('경보 봉 수를 센다', /경보 0봉/.test(r2.node('cFearNote').textContent),
     r2.node('cFearNote').textContent);

  // 공포 자료가 아예 없을 때
  const r3 = run();
  r3.L.BAR.rows = [[at(0), 1, 1, 1, 1, 1, 'day'], [at(1), 1, 1, 1, 1, 1, 'day']];
  r3.L.BAR.fear = [];
  r3.L.drawFear();
  ok('자료 없으면 그렇다고 적는다', /자료가 없습니다/.test(r3.node('cFearNote').textContent),
     r3.node('cFearNote').textContent);
  ok('그래도 예외 없이 끝난다', pathOf('cFear', r3.node) === null);
}
console.log('\n── G. 봉 차트 ──');
{
  const { L, node } = run();

  // 이동평균: 앞의 n-1 개는 낼 수 없다
  const v = [1, 2, 3, 4, 5, 6];
  ok('앞 n-1 개는 null', L.sma(v, 3).slice(0, 2).every(x => x === null));
  ok('세 번째부터 나온다', L.sma(v, 3)[2] === 2, String(L.sma(v, 3)[2]));
  ok('창이 굴러간다', L.sma(v, 3)[5] === 5, String(L.sma(v, 3)[5]));
  ok('봉이 모자라면 전부 null', L.sma([1, 2], 20).every(x => x === null));
  ok('길이는 그대로', L.sma(v, 3).length === 6);
  // 부동소수 누산이 오래 굴러도 안 새는지
  const long = Array.from({ length: 500 }, (_, i) => 100 + (i % 7));
  const last = L.sma(long, 20)[499];
  ok('500봉 뒤에도 정확', Math.abs(last - long.slice(480).reduce((x, y) => x + y, 0) / 20) < 1e-9,
     String(last));

  // 봉 그리기 — [ms, o, h, l, c, v, session]
  const bars = Array.from({ length: 30 }, (_, i) => {
    const up = i % 2 === 0;
    return [at(i), 100, 110, 90, up ? 105 : 95, 1000 + i, 'day'];
  });
  L.BAR.rows = bars; L.BAR.err = null;
  L.drawBars();
  const bodies = node('cPrice').children.filter(c => c._attrs.width !== undefined && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? ''));
  ok('봉 수만큼 몸통', bodies.length === 30, String(bodies.length));
  ok('오른 봉은 --up', bodies[0]._attrs.fill === 'var(--up)', bodies[0]._attrs.fill);
  ok('내린 봉은 --down', bodies[1]._attrs.fill === 'var(--down)', bodies[1]._attrs.fill);
  ok('몸통은 최소 1px', bodies.every(b => +b._attrs.height >= 1));
  ok('거래량 막대도 봉 수만큼',
     node('cVol').children.filter(c => c._attrs.width !== undefined && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? '')).length === 30);
  ok('봉 수를 적는다', /30봉/.test(node('cBarNote').textContent), node('cBarNote').textContent);

  // 이동평균 토글
  const maPaths = () => node('cPrice').children.filter(c =>
    c._attrs.d !== undefined && c._attrs.stroke && c._attrs.stroke.startsWith('var(--ma'));
  ok('꺼져 있으면 이동평균선 없음', maPaths().length === 0);
  L.BAR.ma[20] = true; L.drawBars();
  ok('20선을 켜면 선이 하나', maPaths().length === 1, String(maPaths().length));
  ok('20선 색을 쓴다', maPaths()[0]._attrs.stroke === 'var(--ma20)');
  L.BAR.ma[120] = true; L.BAR.ma[200] = true; L.drawBars();
  ok('봉이 모자란 선은 안 그린다', maPaths().length === 1, String(maPaths().length));
  ok('모자란다고 알려준다', /120·200선은 봉이 모자라/.test(node('cBarNote').textContent),
     node('cBarNote').textContent);

  // 봉 250개면 200선까지 나온다
  const many = Array.from({ length: 250 }, (_, i) => [at(i), 100, 110, 90, 100 + (i % 5), 10, 'day']);
  L.BAR.rows = many; L.drawBars();
  ok('봉이 넉넉하면 세 선 다', maPaths().length === 3, String(maPaths().length));
  ok('선마다 다른 색',
     new Set(maPaths().map(x => x._attrs.stroke)).size === 3);

  // 실패·빈 상태
  const r2 = run();
  r2.L.BAR.rows = []; r2.L.BAR.err = '502 Bad Gateway';
  r2.L.drawBars();
  ok('실패하면 이유를 적는다', /502/.test(r2.node('cBarNote').textContent),
     r2.node('cBarNote').textContent);
  ok('실패하면 봉을 안 그린다',
     r2.node('cPrice').children.filter(c => c._attrs.width !== undefined && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? '')).length === 0);

  const r3 = run();
  r3.L.BAR.rows = [[at(0), 100, 100, 100, 100, 0, 'day']]; r3.L.BAR.err = null;
  r3.L.drawBars();
  ok('봉 하나면 안 그린다',
     r3.node('cPrice').children.filter(c => c._attrs.width !== undefined && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? '')).length === 0);

  // 값이 완전히 평평해도 0 으로 나누면 안 된다
  const r4 = run();
  r4.L.BAR.rows = Array.from({ length: 5 }, (_, i) => [at(i), 100, 100, 100, 100, 1, 'day']);
  r4.L.BAR.err = null;
  r4.L.drawBars();
  const flat = r4.node('cPrice').children.filter(c => c._attrs.width !== undefined && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? ''));
  ok('평평해도 봉이 나온다', flat.length === 5, String(flat.length));
  ok('평평한 봉에 NaN 없음', flat.every(b => !/NaN/.test(b._attrs.y + b._attrs.height)));

  // 저가가 낮고 고가가 아주 높으면 여백이 저가를 뚫고 0 아래로 내려간다.
  // 주가에 음수 눈금이 찍히면 안 된다.
  const r6 = run();
  r6.L.BAR.rows = Array.from({ length: 300 }, (_, i) => [at(i), 40 + i*8, 45 + i*8, 35 + i*8, 42 + i*8, 1, 'day']);
  r6.L.BAR.err = null;
  r6.L.drawBars();
  const yt = r6.node('cPrice').children.filter(c => c._attrs.class === 'ctk' && c._attrs['text-anchor'] === 'end');
  ok('축에 음수 가격이 없다', yt.every(t => !String(t.textContent).startsWith('-')),
     yt.map(t => t.textContent).join());

  // 정규장 밖 봉이 섞이면 알려준다
  const r5 = run();
  r5.L.BAR.rows = [[at(0), 100, 101, 99, 100, 1, 'pre'], [at(1), 100, 101, 99, 100, 1, 'day']];
  r5.L.BAR.err = null;
  r5.L.drawBars();
  ok('정규장 밖 봉을 표시한다', /정규장 밖/.test(r5.node('cBarNote').textContent),
     r5.node('cBarNote').textContent);
}


console.log('\n── H. 크로스헤어 ──');
{
  const { L, node } = run();
  L.BAR.rows = Array.from({ length: 20 }, (_, i) => [at(i), 100, 110, 90, 100 + i, 50, 'day']);
  L.BAR.fear = L.BAR.rows.map((r, i) => [r[0], i, i * 5, 50]);
  L.BAR.err = null;
  L.drawBars();

  ok('가격 칸에 세로·가로선을 심는다', L.HAIRS.some(h => h.svg.id === 'cPrice'));
  ok('거래량 칸에도 심는다', L.HAIRS.some(h => h.svg.id === 'cVol'));
  ok('가격 눈금을 기억한다', L.YSCALE.has('cPrice'));
  ok('거래량 눈금도 기억한다', L.YSCALE.has('cVol'));

  const sc = L.YSCALE.get('cPrice');
  ok('눈금 위끝이 고가보다 높다', sc.hi >= 110, String(sc.hi));
  ok('눈금 아래끝이 저가보다 낮다', sc.lo <= 90, String(sc.lo));
  ok('눈금 값을 통화로 찍는다', sc.fmt(100) === '$100.00', sc.fmt(100));

  // 다시 그리면 옛 선이 남으면 안 된다 — svg 를 비웠으니 참조도 버려야 한다
  const before = L.HAIRS.length;
  L.drawBars();
  ok('다시 그려도 선이 쌓이지 않는다', L.HAIRS.length === before, `${before} → ${L.HAIRS.length}`);
}

console.log('\n── I. 탭 제목 ──');
{
  const { L } = run();
  const snap = (price, ticker, rate) => ({
    at: new Date(T0).toISOString(), pollMs: 5000, windowMin: 60, fastMin: 15,
    minLive: 20, minFast: 10, pairs: [[ticker, null]], pollErrors: 0, rate: rate ?? null,
    alert: 90, sampleMs: 60000, series: {},
    tickers: { [ticker]: { name: ticker, price, error: null, spanMin: 60, warming: false,
      w60: { n: 1, fear: 0, fearN: 0, sentiment: 0, idx: 50, thin: false },
      w15: { n: 1, fear: 0, sentiment: 0, thin: false }, recent: [] } },
  });

  L.UI.ticker = 'SNDK';
  L.setTitle(snap({ close: 1608, open: 1668 }, 'SNDK'));
  ok('내리면 ▼ 와 등락률', document.title === '$1,608.00 ▼3.60% · SNDK', document.title);
  L.setTitle(snap({ close: 1700, open: 1668 }, 'SNDK'));
  ok('오르면 ▲', document.title.startsWith('$1,700.00 ▲'), document.title);

  // 시세가 없으면 원래 제목으로 — 빈 값이 탭에 남으면 안 된다
  L.setTitle(snap(null, 'SNDK'));
  ok('시세 없으면 원래 제목', document.title === '실시간 커뮤니티 온도', document.title);

  // 시가가 없으면 등락률을 못 낸다 — 가격만 띄운다
  L.setTitle(snap({ close: 1608 }, 'SNDK'));
  ok('시가 없으면 가격만', document.title === '$1,608.00 · SNDK', document.title);

  // 종목을 바꾸면 제목도 그 종목 것이어야 한다
  L.UI.ticker = 'MU';
  L.setTitle(snap({ close: 900, open: 900 }, 'MU'));
  ok('보고 있는 종목의 값', document.title.endsWith('· MU'), document.title);
  L.UI.ticker = 'SNDK';

  // 원화로 바꾸면 제목도 따라간다
  const r2 = run();
  r2.L.UI.ticker = 'SNDK';
  r2.L.UI.cur = 'KRW';
  r2.L.paint(snap({ close: 1608, open: 1668 }, 'SNDK', { rate: 1400 }));
  ok('원화면 ₩ 로 환산', document.title.startsWith('₩2,251,200'), document.title);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
