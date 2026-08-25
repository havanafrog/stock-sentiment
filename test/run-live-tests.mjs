// live.html — 실시간 그래프 그리기 검사.
// index.html 쪽은 run-tests.mjs 가 본다.
import { run, pathOf } from './test-live.mjs';
import { readFileSync } from 'node:fs';

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
  // 공포지수는 0~100 고정이라 값이 조금 움직여도 눈금이 안 흔들려야 한다.
  // 지금값 배지가 눈금 글자를 덮으므로 눈금에서 먼 값을 쓴다 — 50 근처면 50 이 지워진다.
  L.spark('cFear', pts([20, 25, 28]), FEAR);
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
  // 지금값 선(class nl)은 기준선이 아니다 — 세지 않는다
  const dashed = node('cFear').children.filter(c => c._attrs['stroke-dasharray'] && c._attrs.class !== 'nl');
  ok('기준선 두 개를 긋는다', dashed.length === 2, String(dashed.length));

  const { L: L2, node: n2 } = run();
  // 범위 밖 기준선은 칸 밖에 그려져 어긋난다 — 아예 안 그린다
  L2.spark('cFear', pts([50, 60]), { ...FEAR, lines: [{ v: 200, color: 'r' }] });
  ok('범위 밖 기준선은 안 긋는다',
     n2('cFear').children.filter(c => c._attrs['stroke-dasharray'] && c._attrs.class !== 'nl').length === 0);
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
  L.BAR.fear = L.BAR.rows.map((r, i) => [r[0], i, i * 10, 40 + i * 10, i, 40 + i * 10]);
  L.paint({
    at: new Date(T0).toISOString(), pollMs: 15000, windowMin: 60, fastMin: 15,
    minLive: 20, minFast: 10, list: ['SNDK'], pollErrors: 0, rate: null,
    alert: 90, sampleMs: 60000, series: {},
    tickers: { SNDK: {
      name: '샌디스크', price: { close: 104 }, error: null, spanMin: 60, warming: false,
      w60: { n: 100, fear: 0.05, fearN: 5, sentiment: 0.1, idx: 62, base: 3.1, baseSd: 2.2, baseN: 23, thin: false },
      w15: { n: 30, fear: 0.05, sentiment: 0.1, thin: false },
      recent: [],
    } },
  });
  ok('곡소리 지수 선을 그렸다', (pathOf('cFear', node) ?? '').startsWith('M'));
  ok('현재 공포지수를 띄운다', node('cNowF').textContent === '80', node('cNowF').textContent);
  ok('현재가를 띄운다', node('cNowP').textContent === '$104.00', node('cNowP').textContent);

  // 글이 없는 구간은 지수가 null 이라 선이 끊겨야 한다
  const r2 = run();
  r2.L.BAR.rows = Array.from({ length: 6 }, (_, i) => [at(i), 100, 110, 90, 100, 10, 'day']);
  r2.L.BAR.fear = [[at(0), 1, 10, 40, 1, 40], [at(1), 2, 20, 60, 2, 60], [at(2), 0, 0, null, 0, null],
                   [at(3), 0, 0, null, 0, null], [at(4), 3, 30, 70, 3, 70], [at(5), 4, 40, 80, 4, 80]];
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
  const bodies = node('cPrice').children.filter(c => c._attrs.width !== undefined && c._attrs.class !== 'nl' && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? ''));
  ok('봉 수만큼 몸통', bodies.length === 30, String(bodies.length));
  ok('오른 봉은 --up', bodies[0]._attrs.fill === 'var(--up)', bodies[0]._attrs.fill);
  ok('내린 봉은 --down', bodies[1]._attrs.fill === 'var(--down)', bodies[1]._attrs.fill);
  ok('몸통은 최소 1px', bodies.every(b => +b._attrs.height >= 1));
  ok('거래량 막대도 봉 수만큼',
     node('cVol').children.filter(c => c._attrs.width !== undefined && c._attrs.class !== 'nl' && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? '')).length === 30);
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
     r2.node('cPrice').children.filter(c => c._attrs.width !== undefined && c._attrs.class !== 'nl' && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? '')).length === 0);

  const r3 = run();
  r3.L.BAR.rows = [[at(0), 100, 100, 100, 100, 0, 'day']]; r3.L.BAR.err = null;
  r3.L.drawBars();
  ok('봉 하나면 안 그린다',
     r3.node('cPrice').children.filter(c => c._attrs.width !== undefined && c._attrs.class !== 'nl' && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? '')).length === 0);

  // 값이 완전히 평평해도 0 으로 나누면 안 된다
  const r4 = run();
  r4.L.BAR.rows = Array.from({ length: 5 }, (_, i) => [at(i), 100, 100, 100, 100, 1, 'day']);
  r4.L.BAR.err = null;
  r4.L.drawBars();
  const flat = r4.node('cPrice').children.filter(c => c._attrs.width !== undefined && c._attrs.class !== 'nl' && /^var\(--(up|down)\)$/.test(c._attrs.fill ?? ''));
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
  L.BAR.fear = L.BAR.rows.map((r, i) => [r[0], i, i * 5, 50, i, 50]);
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
    minLive: 20, minFast: 10, list: [ticker], pollErrors: 0, rate: rate ?? null,
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

console.log('\n── J. 종목 관리 ──');
{
  const { L, node } = run();
  const row = (t, opt = {}) => ({ t, name: t + '이름', baseline: opt.baseline ?? true, job: opt.job ?? null });

  L.tkRender({ rows: [row('SNDK'), row('KORU')],
               count: 3, pollMs: 5000, lastPollMs: 650, crowded: false });
  const html = node('tkList').innerHTML;
  // 위의 판이 같은 목록을 이미 보여준다. 여기는 지우는 자리라 칩 한 줄이면 된다.
  ok('종목마다 칩 하나', (html.match(/tkchip/g) || []).length === 2, html);
  ok('종목 기호가 보인다', html.includes('>KORU'), html);
  ok('삭제 버튼에 종목이 붙는다', html.includes('data-del="KORU"'));
  ok('기준선 있으면 경고 없음', !html.includes('기준선 없음'));
  ok('폴링 상태를 적는다', /3개 종목 · 폴링 5초 · 한 바퀴 650ms/.test(node('tkNote').textContent),
     node('tkNote').textContent);

  // 갓 추가한 종목 — 기준선이 아직 없다
  L.tkRender({ rows: [row('TSLA', { baseline: false })],
               count: 1, pollMs: 5000, lastPollMs: 200, crowded: false });
  ok('기준선 없으면 그렇다고 적는다', node('tkList').innerHTML.includes('기준선 없음'));

  // 수집이 도는 중
  L.tkRender({ rows: [row('TSLA', { baseline: false,
                 job: { phase: '글 수집 중', pages: 120, posts: 1320 } })],
               count: 1, pollMs: 5000, lastPollMs: 200, crowded: false });
  const busy = node('tkList').innerHTML;
  ok('수집 단계를 적는다', busy.includes('글 수집 중'));
  // 칩은 좁다. 쪽수만 적고 건수는 뺀다 — 둘 다 넣으면 줄이 넘친다.
  ok('진행 쪽수를 적는다', busy.includes('120쪽'), busy.slice(0, 160));
  ok('수집 중이면 눈에 띈다', busy.includes('tkchip warm'), busy.slice(0, 80));

  // 종목이 많아 한 바퀴가 주기에 근접
  L.tkRender({ rows: [row('A')], count: 20, pollMs: 5000, lastPollMs: 4200, crowded: true });
  ok('혼잡하면 경고한다', /주기에 근접/.test(node('tkNote').textContent), node('tkNote').textContent);
  ok('경고는 색으로도 표시', node('tkNote').style.color === 'var(--fear-ink)');
}

console.log('\n── K. 보조지표 ──');
{
  const { L, node } = run();

  // EMA — 앞의 n-1 개는 씨를 못 뿌린다
  const v = [1, 2, 3, 4, 5, 6, 7, 8];
  ok('EMA 앞은 null', L.ema(v, 3).slice(0, 2).every(x => x === null));
  ok('EMA 첫 값은 단순평균', L.ema(v, 3)[2] === 2, String(L.ema(v, 3)[2]));
  ok('EMA 길이 보존', L.ema(v, 3).length === 8);
  ok('봉이 모자라면 전부 null', L.ema([1, 2], 20).every(x => x === null));
  // 값이 일정하면 EMA 도 그 값이다
  const flat = new Array(30).fill(50);
  ok('평평하면 EMA 도 평평', L.ema(flat, 12).slice(11).every(x => Math.abs(x - 50) < 1e-9));

  // MACD
  const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 7) * 8 + i * 0.15);
  const m = L.macd(closes);
  ok('MACD 세 줄 다 원본 길이', m.line.length === 120 && m.signal.length === 120 && m.hist.length === 120);
  ok('느린 EMA 전에는 선이 없다', m.line.slice(0, 25).every(x => x === null));
  ok('26번째부터 선이 난다', m.line[25] !== null);
  ok('시그널은 선보다 늦게 난다', m.signal.findIndex(x => x !== null) > m.line.findIndex(x => x !== null));
  const k = 100;
  ok('히스토그램 = 선 − 시그널', Math.abs(m.hist[k] - (m.line[k] - m.signal[k])) < 1e-9);
  // 값이 일정하면 MACD 는 0 이다
  const fm = L.macd(new Array(80).fill(42));
  ok('평평하면 MACD 0', Math.abs(fm.line[79]) < 1e-9, String(fm.line[79]));

  // RSI
  const up = Array.from({ length: 60 }, (_, i) => 100 + i);      // 계속 오름
  const dn = Array.from({ length: 60 }, (_, i) => 200 - i);      // 계속 내림
  ok('계속 오르면 RSI 100', Math.abs(L.rsi(up)[59] - 100) < 1e-9, String(L.rsi(up)[59]));
  ok('계속 내리면 RSI 0', Math.abs(L.rsi(dn)[59]) < 1e-9, String(L.rsi(dn)[59]));
  ok('앞 14개는 null', L.rsi(up).slice(0, 14).every(x => x === null));
  ok('봉이 모자라면 전부 null', L.rsi([1, 2, 3]).every(x => x === null));
  const r = L.rsi(closes);
  ok('RSI 는 0~100 안', r.filter(x => x !== null).every(x => x >= 0 && x <= 100));

  // 그리기 — 꺼져 있으면 칸이 숨는다
  L.BAR.rows = closes.map((c, i) => [Date.UTC(2026, 7, 19) + i * 60000, c, c + 1, c - 1, c, 100, 'day']);
  L.BAR.err = null; L.BAR.view = null;
  L.BAR.ind.macd = false; L.BAR.ind.rsi = false;
  L.drawBars();
  ok('꺼져 있으면 MACD 칸 숨김', node('cMacd').hidden === true);
  ok('꺼져 있으면 RSI 칸 숨김', node('cRsi').hidden === true);

  L.BAR.ind.macd = true; L.BAR.ind.rsi = true;
  L.drawBars();
  ok('켜면 MACD 칸이 보인다', node('cMacd').hidden === false);
  ok('켜면 RSI 칸이 보인다', node('cRsi').hidden === false);
  const mLines = node('cMacd').children.filter(c => c._attrs.d !== undefined);
  ok('MACD 는 선 두 개 (MACD·시그널)', mLines.length === 2, String(mLines.length));
  const mBars = node('cMacd').children.filter(c => c._attrs.width !== undefined && /var\(--(up|down)\)/.test(c._attrs.fill ?? ''));
  ok('히스토그램 막대도 그린다', mBars.length > 50, String(mBars.length));
  ok('RSI 는 선 하나', node('cRsi').children.filter(c => c._attrs.d !== undefined).length === 1);
  ok('RSI 눈금은 0~100 고정', L.YSCALE.get('cRsi').lo === 0 && L.YSCALE.get('cRsi').hi === 100);
  const dashed = node('cRsi').children.filter(c => c._attrs['stroke-dasharray']);
  ok('RSI 에 30·70 선', dashed.length >= 2, String(dashed.length));

  // 봉이 모자랄 때
  const r2 = run();
  r2.L.BAR.ind.rsi = true;
  r2.L.BAR.rows = Array.from({ length: 5 }, (_, i) => [Date.UTC(2026, 7, 19) + i * 60000, 100, 101, 99, 100, 1, 'day']);
  r2.L.BAR.err = null;
  r2.L.drawBars();
  ok('봉이 모자라면 그렇다고 적는다', r2.node('cRsi').children.some(c => /모자/.test(c.textContent ?? '')));
}
// ── L. 좁은 화면 ──
// 폰에서 600 폭을 320px 에 밀어 넣으면 9px 눈금이 5px 로 읽힌다.
// viewBox 를 좁혀 글자를 제 크기로 되돌리는지 본다.
{
  const { L, node } = run();
  L.BAR.rows = Array.from({ length: 60 }, (_, i) => [at(i), 100, 110, 90, 105, 10, 'day']);
  L.BAR.fear = [];
  L.BAR.err = null;

  ok('넓은 화면에선 바꿀 게 없다', L.fitCharts() === false);

  global.innerWidth = 390;
  ok('좁아지면 다시 잡는다', L.fitCharts() === true);
  ok('폰 viewBox 는 380 폭', node('cPrice')._attrs.viewBox === '0 0 380 250');
  ok('거래량 칸도 같이 바뀐다', node('cVol')._attrs.viewBox === '0 0 380 52');
  ok('곡소리 칸도 같이 바뀐다', node('cFear')._attrs.viewBox === '0 0 380 112');
  ok('폭이 그대로면 안 바뀌었다고 답한다', L.fitCharts() === false);
  // 다시 그리면 card() 가 문서 값을 되씌운다 — drawBars 가 다시 잡아야 한다.
  node('cPrice')._attrs.viewBox = '0 0 600 200';
  L.drawBars();
  ok('다시 그려도 폰 치수를 지킨다', node('cPrice')._attrs.viewBox === '0 0 380 250');

  L.drawBars();
  const xs = node('cPrice').children
    .filter(c => c._attrs.width !== undefined && c._attrs.x !== undefined)
    .map(c => Number(c._attrs.x));
  ok('봉이 380 폭 안에 들어온다', xs.length > 0 && Math.max(...xs) < 380, String(Math.max(...xs)));

  global.innerWidth = 1280;
  ok('넓어지면 되돌아온다', L.fitCharts() === true
    && node('cPrice')._attrs.viewBox === '0 0 600 200');
}

// ── M. 매수/매도 압력 (MFI) ──
// 체결강도는 장중 누적값 하나뿐이라 봉마다 못 본다. MFI 가 그 자리를 메운다.
{
  const { L, node } = run();
  const bar = (i, tp, vol) => [at(i), tp, tp, tp, tp, vol, 'day'];

  ok('봉이 모자라면 전부 null', L.mfi([bar(0, 10, 1), bar(1, 11, 1)]).every(v => v === null));

  // 15봉 내내 오르기만 하면 매도 쪽 흐름이 0 → 100
  const up = Array.from({ length: 20 }, (_, i) => bar(i, 100 + i, 1000));
  const mu = L.mfi(up);
  ok('앞 14봉은 값이 없다', mu.slice(0, 14).every(v => v === null));
  ok('내리 오르면 100', mu[14] === 100 && mu[19] === 100);

  // 내리기만 하면 0
  const dn = Array.from({ length: 20 }, (_, i) => bar(i, 100 - i, 1000));
  ok('내리 내리면 0', L.mfi(dn)[19] === 0);

  // 값이 그대로면 어느 쪽도 아니다 → 50
  const flat = Array.from({ length: 20 }, (_, i) => bar(i, 100, 1000));
  ok('제자리면 50', L.mfi(flat)[19] === 50);

  // 창 밖으로 나간 봉은 빠져야 한다: 앞은 오르고 뒤는 내리면 100 에서 떨어진다
  const mix = [...Array.from({ length: 15 }, (_, i) => bar(i, 100 + i, 1000)),
               ...Array.from({ length: 15 }, (_, i) => bar(15 + i, 114 - i, 1000))];
  const mm = L.mfi(mix);
  ok('오르다 내리면 100 에서 내려온다', mm[14] === 100 && mm[29] < 20, `${mm[14]} → ${mm[29]}`);
  ok('0~100 을 벗어나지 않는다', mm.filter(v => v !== null).every(v => v >= 0 && v <= 100));

  // 거래량이 크면 그 봉이 더 무겁다
  const heavyUp = [...Array.from({ length: 15 }, (_, i) => bar(i, 100, 1)),
                   bar(15, 101, 1_000_000), bar(16, 100.5, 1)];
  ok('거래량이 큰 봉이 더 무겁다', L.mfi(heavyUp)[16] > 50);

  // 켜고 끄기
  L.BAR.rows = Array.from({ length: 60 }, (_, i) => [at(i), 100, 110, 90, 100 + (i % 7), 1000, 'day']);
  L.BAR.fear = []; L.BAR.err = null;
  L.BAR.ind.mfi = false;
  L.drawBars();
  ok('꺼져 있으면 압력 칸 숨김', node('cMfi').hidden === true);
  L.BAR.ind.mfi = true;
  L.drawBars();
  ok('켜면 압력 칸이 보인다', node('cMfi').hidden === false);
  // CSS 는 자바스크립트 속성이 아니라 문서의 hidden 을 본다.
  ok('켜면 문서에서도 hidden 이 빠진다', node('cMfi').hasAttribute('hidden') === false);
  L.BAR.ind.mfi = false; L.drawBars();
  ok('끄면 문서에 hidden 이 붙는다', node('cMfi').hasAttribute('hidden') === true);
  L.BAR.ind.mfi = true; L.drawBars();
  ok('압력은 선 하나', node('cMfi').children.filter(c => c._attrs.d !== undefined).length === 1);
  ok('눈금은 0~100 고정', L.YSCALE.get('cMfi').lo === 0 && L.YSCALE.get('cMfi').hi === 100);
  ok('20 · 50 · 80 선', node('cMfi').children.filter(c => c._attrs['stroke-dasharray']).length >= 3);
}

// ── N. 글 목록 날짜 ──
// 날짜는 미국 동부 장 하루(r.d), 시각은 보는 사람 시계였다. 한국 00~13시 글이
// 하루씩 밀렸다 — 08-21 09:14 글이 08-20 09:14 로 찍혔다.
{
  const { L } = run();
  // ET 로는 전날 20:14, KST 로는 당일 09:14 인 시각
  const iso = '2026-08-21T09:14:00+09:00';
  ok('날짜가 시각과 같은 기준으로 나온다', L.fmtYMD(iso) === '2026-08-21', L.fmtYMD(iso));
  ok('자정 직후도 맞다', L.fmtYMD('2026-08-21T00:05:00+09:00') === '2026-08-21');
  ok('자정 직전도 맞다', L.fmtYMD('2026-08-20T23:55:00+09:00') === '2026-08-20');
}

// ── O. 라벨 줄 ──
// 사전이 놓치는 자리를 찾으려면 사람이 찍어야 한다. 화면은 세 버튼과
// 사전이 뭐라 했는지만 보여준다 — 어긋나야 눈에 띈다.
{
  const { L } = run();
  const row = (s, y) => ({ id: 7, at: 'x', text: 't', likes: 0, s, f: false, d: '2026-08-13', y });

  ok('안 찍은 글은 눌린 버튼이 없다', !L.labRow(row(-0.4, null)).includes('aria-pressed="true"'));
  ok('찍은 값이 눌려 있다',
     (L.labRow(row(-0.4, 'N')).match(/aria-pressed="true"/g) || []).length === 1);
  ok('버튼은 셋', (L.labRow(row(0, null)).match(/<button/g) || []).length === 3);

  // 사전 예측은 점수 부호 그대로다
  ok('점수가 양수면 사전은 긍정', L.labRow(row(0.4, null)).includes('사전: 긍정'));
  ok('0 이면 중립', L.labRow(row(0, null)).includes('사전: 중립'));
  ok('음수면 부정', L.labRow(row(-0.4, null)).includes('사전: 부정'));

  ok('사전과 같으면 체크', L.labRow(row(-0.4, 'N')).includes('\u2713'));
  ok('어긋나면 가위표', L.labRow(row(0, 'N')).includes('\u2717'));
  ok('어긋나야 bad 가 붙는다', L.labRow(row(0, 'N')).includes('pdict bad'));
  ok('같으면 bad 가 없다', !L.labRow(row(-0.4, 'N')).includes('pdict bad'));
  ok('안 찍었으면 표시가 없다',
     !L.labRow(row(0, null)).includes('\u2713') && !L.labRow(row(0, null)).includes('\u2717'));

  ok('라벨은 기본이 꺼짐', L.P.label === false);
  ok('기본 보기는 안 찍은 것', L.P.lab === 'none');
}
// ── P. 가로선 ──
// lo · 가운데 · hi 를 그대로 찍으면 1593.47 같은 값이 나온다. 아무 뜻도 없고
// 종목마다 눈금이 달라 견줄 수도 없다. 1 · 2 · 5 배수로 끊는다.
{
  const { L, node } = run();

  ok('1590~1602 는 5 단위로', L.niceTicks(1590, 1602).join() === '1590,1595,1600');
  ok('0~100 은 50 단위로', L.niceTicks(0, 100).join() === '0,50,100');
  ok('0~1 은 소수로', L.niceTicks(0, 1).join() === '0,0.5,1');
  ok('모두 간격이 같다', (t => t.every((v, i) => i < 2 || 
     Math.abs((v - t[i-1]) - (t[1] - t[0])) < 1e-9))(L.niceTicks(37, 184)),
     L.niceTicks(37, 184).join());
  ok('범위 안에만 있다', L.niceTicks(37, 184).every(v => v >= 37 && v <= 184));
  ok('둘 이상 나온다', L.niceTicks(1000.1, 1000.4).length >= 2);
  ok('평평하면 안 죽는다', L.niceTicks(5, 5).length >= 1);

  // 지금 값 — 점선 하나와 배지 하나가 늘 붙는다
  L.spark('cFear', pts([50, 60]), FEAR);
  const nl = node('cFear').children.filter(c => c._attrs.class === 'nl');
  ok('지금값은 선과 배지 둘', nl.length === 2, String(nl.length));
  ok('선은 점선', nl.some(c => c._attrs['stroke-dasharray']));
  ok('배지는 칸 밖으로 안 나간다', nl.every(c => Number(c._attrs.x ?? 0) >= 0));
  const txt = node('cFear').children.filter(c => c._attrs.class === 'cnow');
  ok('배지에 지금 값이 찍힌다', txt.length === 1 && txt[0].textContent.includes('60'),
     txt[0]?.textContent);

  // 배지와 눈금 글자가 겹치면 둘 다 못 읽는다. 깔리는 쪽을 지운다.
  const { L: L2, node: n2 } = run();
  L2.spark('cFear', pts([48, 49, 50]), FEAR);          // 지금값이 50 눈금 위
  const shown = n2('cFear').children
    .filter(c => c._attrs.class === 'ctk' && c.textContent !== '').map(c => c.textContent);
  ok('배지에 깔린 눈금은 지운다', !shown.includes('50'), shown.join());
  ok('나머지 눈금은 남는다', shown.includes('0') && shown.includes('100'), shown.join());
}

// ── Q. 가로축 시각 눈금 ──
// 양 끝 두 개만 있으면 가운데 봉이 언제인지 알 길이 없었다.
{
  const { L, node } = run();
  const H = 36e5;

  // 10분봉 6시간치 — 시간 경계마다 잡혀야 한다
  const s6 = Array.from({ length: 36 }, (_, i) => Date.UTC(2026, 7, 20, 0, 0) + i * 6e5);
  const t6 = L.timeTicks(s6);
  ok('여러 자리가 나온다', t6.length >= 3, String(t6.length));
  ok('순번은 오름차순', t6.every((t, i) => i === 0 || t.i > t[i-1]?.i || t.i > t6[i-1].i));
  ok('간격이 고르다', (() => {
     const gaps = t6.slice(1).map((t, i) => t.i - t6[i].i);
     return new Set(gaps).size <= 2;
   })(), t6.map(t => t.i).join());

  // 하루를 넘으면 날짜 바뀌는 자리가 표시된다
  const s2d = Array.from({ length: 48 }, (_, i) => Date.UTC(2026, 7, 20) + i * H);
  ok('날짜가 바뀌는 자리를 표시한다', L.timeTicks(s2d).some(t => t.day));

  ok('봉이 하나면 빈 배열', L.timeTicks([1]).length === 0);
  ok('전부 같은 시각이면 빈 배열', L.timeTicks([5, 5, 5]).length === 0);

  // 넓은 범위일수록 성긴 간격을 고른다 — 개수가 폭발하지 않아야 한다
  const s90 = Array.from({ length: 90 }, (_, i) => Date.UTC(2026, 5, 1) + i * 864e5);
  ok('90일도 눈금이 열 개를 안 넘는다', L.timeTicks(s90).length <= 10,
     String(L.timeTicks(s90).length));

  // 실제로 그려지는지
  const at = i => Date.UTC(2026, 7, 20, 0, 0) + i * 6e5;
  L.BAR.rows = Array.from({ length: 40 }, (_, i) =>
    [at(i), 100, 101, 99, 100 + (i % 3), 1000, 'min']);
  L.BAR.err = null;
  L.drawBars();
  const xs = node('cPrice').children.filter(c => c._attrs.class?.startsWith('ctk'));
  ok('가로축 글자가 셋 이상', xs.length >= 3, String(xs.length));
  const vlines = node('cPrice').children.filter(c =>
    c._attrs.class === 'gl' && c._attrs.x1 === c._attrs.x2);
  ok('세로선도 같이 선다', vlines.length >= 1, String(vlines.length));
}

// ── R. 기본 화면 ──
// 글은 90일치인데 토스는 일봉을 376개 준다. 다 그리면 화면의 84%가 빈 칸이다.
{
  const { L } = run();
  const n = 100;
  L.BAR.rows = Array.from({ length: n }, (_, i) => [i * 864e5, 10, 11, 9, 10, 1, 'day']);
  const fearFrom = k => Array.from({ length: n },
    (_, i) => [i * 864e5, 0, i < k ? 0 : 5, 50, 0, 50]);
  L.BAR.view = null;

  L.BAR.fear = [];
  ok('곡소리가 없으면 전체', L.viewRange().join() === '0,' + (n-1), L.viewRange().join());

  L.BAR.fear = fearFrom(70);          // 앞 70봉은 글이 없다
  ok('빈 앞구간은 기본 화면에서 뺀다', L.viewRange().join() === '70,' + (n-1), L.viewRange().join());

  L.BAR.fear = fearFrom(95);          // 남는 게 5봉뿐이면 읽을 게 없다
  ok('남는 봉이 적으면 그냥 전체', L.viewRange().join() === '0,' + (n-1), L.viewRange().join());

  L.BAR.fear = [[0, 0, 5, 50, 0, 50]];   // 아직 안 받아온 상태
  ok('길이가 다르면 전체', L.viewRange().join() === '0,' + (n-1));

  L.BAR.fear = fearFrom(70);
  L.BAR.view = [0, n - 1];            // 휠로 끝까지 줄인 경우
  ok('전체를 박으면 전체', L.viewRange().join() === '0,' + (n-1));
  L.BAR.view = null;
}
// ── S. 종목 판 ──
// 버튼 줄로는 "지금 뭐가 도는지" 를 알 수 없다. 거래대금·거래량·곡소리를 나란히 놓는다.
{
  const { L, node } = run();
  const mk = (close, base, volume, preVolume, value, strength, idx) =>
    ({ name: '이름', price: { close, base, volume, preVolume, value, strength }, w60: { idx } });
  const T = {
    AAA: mk(110, 100, 200, 100, 900, 120, 95),   // +10% · 거래량 2배 · 경보
    BBB: mk(90, 100, 50, 100, 100, 80, 40),      // -10% · 거래량 절반
    CCC: mk(100, 100, 150, 100, 500, 100, 60),   // 보합
  };
  const order = ['AAA', 'BBB', 'CCC'];
  const syms = () => [...node('boardBody').innerHTML.matchAll(/data-t="(\w+)"/g)].map(m => m[1]);

  ok('등락은 전일 종가 기준', Math.abs(L.chgOf({ close: 110, base: 100 }) - 0.1) < 1e-9);
  ok('전일 종가가 없으면 null', L.chgOf({ close: 110, base: null }) === null);

  L.BOARD.key = 'value'; L.BOARD.desc = true;
  L.paintBoard(order, T, []);
  ok('기본은 거래대금 내림차순', syms().join() === 'AAA,CCC,BBB', syms().join());

  L.BOARD.desc = false; L.paintBoard(order, T, []);
  ok('방향을 뒤집는다', syms().join() === 'BBB,CCC,AAA', syms().join());

  L.BOARD.key = 'idx'; L.BOARD.desc = true; L.paintBoard(order, T, []);
  ok('곡소리순', syms().join() === 'AAA,CCC,BBB', syms().join());

  L.BOARD.key = 'sym'; L.BOARD.desc = false; L.paintBoard(order, T, []);
  ok('종목명순', syms().join() === 'AAA,BBB,CCC', syms().join());

  L.BOARD.key = 'value'; L.BOARD.desc = true;
  L.paintBoard(order, T, ['AAA']);
  const h = node('boardBody').innerHTML;
  ok('오른 종목은 up', /class="chg up">\+10\.00%/.test(h), h.slice(0, 160));
  ok('내린 종목은 down', /class="chg down">-10\.00%/.test(h));
  // 비율만 보면 $1 짜리와 $1,500 짜리가 같아 보인다. 액수도 붙는다.
  ok('등락액도 같이', /chgv">\+\$10\.00/.test(h) && /chgv">-\$10\.00/.test(h),
     h.slice(0, 400));
  ok('순번이 붙는다', /class="rk">1</.test(h) && /class="rk">3</.test(h));
  ok('전일보다 많으면 hot', /rel hot">200%/.test(h));
  ok('전일보다 적으면 그냥', /class="rel">50%/.test(h));
  L.paintBoard(['EEE'], { EEE: { name: 'x',
    price: { close: 1, base: 1, volume: 3, preVolume: 1000, value: 1, strength: 1 }, w60: {} } }, []);
  ok('장 초반 0% 대신 <1%', node('boardBody').innerHTML.includes('&lt;1%')
     || node('boardBody').innerHTML.includes('<1%'), node('boardBody').innerHTML.slice(0,220));
  ok('경보는 눈에 띈다', /idx alert">95/.test(h));
  ok('공포 종목엔 점', /fdot/.test(h));

  // 장 시작 전에는 price 가 통째로 없다. 그래도 판은 그려져야 한다.
  L.paintBoard(['DDD'], { DDD: { name: 'x', price: null, w60: {} } }, []);
  ok('시세가 없으면 줄표', node('boardBody').innerHTML.includes('—'));
}
console.log('\n── R. 탭 ──');
{
  const src = readFileSync('live.html', 'utf8');
  // 종목 추가는 메인 탭 안에만 있어야 한다. 밖에 두면 어느 탭을 눌러도 따라 나온다.
  const from = src.indexOf('<div id="viewBoard">');
  const to = src.indexOf('<!-- /viewBoard -->');
  ok('viewBoard 가 닫힌다', from > 0 && to > from, `${from} ${to}`);
  const board = src.slice(from, to);
  ok('종목 추가는 메인 안에', board.includes('종목 추가') && board.includes('id="tkList"'));
  // 판이 하나뿐인지도 본다 — 옮기다 복사본을 남기면 두 곳에 뜬다.
  // (CSS 주석과 스크립트에도 tkList 가 나오므로 마크업만 센다.)
  ok('종목 추가 판은 하나', (src.match(/id="tkList"/g) || []).length === 1);
  ok('머리글도 하나', (src.match(/class="tkhead"/g) || []).length === 1);

  // 전환은 무거운 일보다 먼저 그려져야 한다. 한 프레임에 같이 넣으면 뚝뚝 끊긴다.
  const show = src.slice(src.indexOf('const show = name =>'), src.indexOf('showTab = show;'));
  ok('무거운 일은 다음 프레임에', show.includes('requestAnimationFrame(() => requestAnimationFrame('), show.slice(0, 80));
  ok('빠르게 눌러도 마지막 것만', show.includes('if (mine !== turn) return;'));
  ok('rAF 가 없으면 그냥 부른다', show.includes('else heavy();'));
}
console.log('\n── S. 누른 것 ──');
{
  const { L, node } = run();

  // 투표 — 아무도 안 눌렀으면 비율을 그리지 않는다. 없는 합의를 그리는 셈이다.
  L.pulseRender({ ticker: 'KORU', day: '2026-08-25',
    vote: { up: 0, down: 0, mine: null }, mood: { hit: 0, pet: 0, happy: 0 }, wait: 0 });
  ok('표가 없으면 채우지 않는다', node('voteUn').textContent === '—' && node('voteU').style['--fill'] === '0%', node('voteU').style['--fill']);
  ok('표가 없다고 적는다', node('pulseCount').textContent.includes('아직'));

  L.pulseRender({ ticker: 'KORU', day: '2026-08-25',
    vote: { up: 3, down: 1, mine: 'U' }, mood: { hit: 10, pet: 4, happy: -6 }, wait: 0 });
  ok('종목을 적는다', node('pulseSym').textContent === 'KORU');
  const vbtn = [node('voteU'), node('voteD')];
  const vtext = [node('voteUn').textContent, node('voteDn').textContent];
  ok('비율을 낸다', vtext[0] === '75% (3)' && vtext[1] === '25% (1)', vtext.join(' | '));
  ok('총원을 적는다', node('pulseCount').textContent.includes('4명'));
  ok('내가 누른 쪽에 표시', vbtn[0].getAttribute('aria-pressed') === 'true' && vbtn[1].getAttribute('aria-pressed') === 'false');

  // 기분 — 행복도가 음수면 화난 얼굴이다.
  ok('행복도를 적는다', node('moodHappy').textContent === '-6');
  ok('행복도가 음수면 화난 얼굴', node('moodFace').textContent === '\uD83D\uDE21');
  L.pulseRender({ ticker: 'KORU', day: '2026-08-25',
    vote: { up: 0, down: 0, mine: null }, mood: { hit: 1, pet: 9, happy: 8 }, wait: 0 });
  ok('행복도가 양수면 웃는 얼굴', node('moodFace').textContent === '\uD83D\uDE0A');
  ok('양수엔 부호를 붙인다', node('moodHappy').textContent === '+8');

  // 쿨다운 — 남았으면 버튼을 잠근다. 눌러도 안 먹는데 눌리면 속은 기분이 든다.
  ok('쿨다운이 없으면 누를 수 있다', !node('moodPet').disabled && !node('moodHit').disabled);
  L.pulseRender({ ticker: 'KORU', day: '2026-08-25',
    vote: { up: 0, down: 0, mine: null }, mood: { hit: 0, pet: 0, happy: 0 }, wait: 12_000 });
  ok('쿨다운이 남으면 잠근다', node('moodPet').disabled && node('moodHit').disabled);
  ok('몇 초 남았는지 적는다', node('moodNote').textContent.includes('12초'), node('moodNote').textContent);
}

console.log('\n── T. 내 평단 ──');
{
  const src = readFileSync('live.html', 'utf8');
  // 평단은 서버에 안 보낸다. 남의 평단을 우리가 가지고 있을 이유가 없다.
  const send = src.slice(src.indexOf('const avgKey'), src.indexOf('// ── 컨트롤 ──'));
  ok('평단을 서버로 보내지 않는다', !/fetch\(/.test(send), send.slice(0, 80));
  ok('평단은 종목마다 따로 둔다', send.includes("'avg.' + t"));

  // 눈금 밖이면 안 그린다 — 칸 끝에 붙여 그리면 거기 값이 있는 것처럼 보인다.
  const draw = src.slice(src.indexOf("if ($('avgLine').checked)"), src.indexOf('// 가로축. 정각'));
  ok('눈금 밖이면 안 그린다', draw.includes('ay >= lo && ay <= hi'), draw.slice(0, 120));
  ok('통화를 거쳐 그린다', draw.includes('cur(a)'));
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
