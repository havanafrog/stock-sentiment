// 덮여 죽은 선언 찾기. 폰 규칙(@media max-width: 640px) 안의 선언마다
// 하나씩 빼 보고, 걸리는 요소의 getComputedStyle 이 하나도 안 바뀌면 안 먹은 것이다.
//
// 안 먹은 것은 둘로 가른다. 같은 선언에 !important 를 붙였을 때 값이 바뀌면
// 다른 규칙에 져서 죽은 것(DEAD)이고, 그래도 안 바뀌면 원래 값과 같아 할 일이
// 없는 것(같음)이다. 노치 top·탭 줄 margin·탭 padding 이 앞의 것이었다.
//
// 숨은 탭의 요소는 transform 같은 값을 늘 none 으로 읽는다 — 접기 화살표가 그래서
// '같음' 으로 잘못 나왔다. 탭마다 열어 두고 화면에 그려진 요소만 재서 합친다.
// 어느 한 탭에서라도 먹으면 먹은 것이다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/dead-css.mjs "http://127.0.0.1:8741/?k=<키>" [폭] [높이]
const URL_ = process.argv[2];
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844);
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const w = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; w.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MEASURE = `(() => {
  const out = [];
  const walk = (rules, inPhone) => {
    for (const r of rules) {
      if (r instanceof CSSMediaRule) {
        const phone = inPhone || /max-width:\\s*640px/.test(r.conditionText);
        if (matchMedia(r.conditionText).matches) walk(r.cssRules, phone);
      } else if (inPhone && r instanceof CSSStyleRule) check(r);
    }
  };
  const targets = r => r.selectorText.split(/,(?![^(]*\\))/).flatMap(s => {
    const m = s.match(/::?(after|before|placeholder|details-content|-webkit-details-marker|-webkit-scrollbar)\\s*$/);
    if (m && m[1] === '-webkit-scrollbar') return [];
    const base = m ? s.slice(0, m.index) : s;
    return [...document.querySelectorAll(base.trim() || '*')]
      // 화면에 그려진 것만. display: none/contents 선언은 제 요소를 스스로 지우니
      // 부모가 그려졌으면 센다.
      .filter(el => el.getClientRects().length || el.parentElement?.getClientRects().length)
      .map(el => [el, m ? '::' + m[1] : null]);
  });
  const snap = (ts, p) => ts.map(([el, ps]) => getComputedStyle(el, ps).getPropertyValue(p)).join('|');
  const check = r => {
    const ts = targets(r);
    const saved = r.style.cssText;
    // 풀어 쓴 칸(padding-top …)이 아니라 적힌 선언(padding: …) 단위로 본다.
    // var() 가 든 줄임말은 칸마다 값이 빈 문자열이라 칸 단위로는 못 잰다.
    const decls = saved.split(/;(?![^(]*\\))/).map(d => d.trim()).filter(Boolean)
      .map(d => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).replace(/!important/, '').trim()]);
    for (const [p, val] of decls) {
      if (!ts.length) { out.push({ sel: r.selectorText, p, val, kind: '요소 없음' }); continue; }
      const on = snap(ts, p);
      // 값이 비었거나, 전환처럼 아래에서 꺼 둔 것은 못 잰다.
      if (!on.replace(/\\|/g, '') || /^transition/.test(p)) { out.push({ sel: r.selectorText, p, val, kind: '못 잼' }); continue; }
      r.style.removeProperty(p);
      const off = snap(ts, p);
      r.style.cssText = saved;
      if (on !== off) { out.push({ sel: r.selectorText, p, kind: '먹음' }); continue; }
      r.style.setProperty(p, val, 'important');
      const forced = snap(ts, p);
      r.style.cssText = saved;
      out.push({ sel: r.selectorText, p, val: val.slice(0, 40), kind: forced !== on ? 'DEAD' : '같음',
        now: on.split('|')[0].slice(0, 30), want: forced.split('|')[0].slice(0, 30) });
    }
  };
  for (const s of document.styleSheets) walk(s.cssRules, false);
  return out;
})()`;

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url: URL_ });
await sleep(9000);
// 전환이 걸린 값은 빼도 바로 안 바뀌어 '같음' 으로 잘못 나온다 — 끄고 잰다.
await js(`document.head.insertAdjacentHTML('beforeend', '<style>*, *::before, *::after { transition: none !important; }</style>')`);

const RANK = ['먹음', 'DEAD', '같음', '못 잼', '요소 없음'];
const merged = new Map();
for (const tab of ['#tabBoard', '#tabMain', '#tabAnalysis', '#tabPosts', '#tabHelp']) {
  await js(`document.querySelector('${tab}').click()`);
  await sleep(2500);
  await js(`document.querySelectorAll('details').forEach(d => d.open = true)`);
  if (tab === '#tabMain') await js(`BAR.view = [BAR.rows.length - 30, BAR.rows.length - 1]; drawBars()`);
  await sleep(500);
  for (const r of await js(MEASURE)) {
    const k = r.sel + '|' + r.p, old = merged.get(k);
    if (!old || RANK.indexOf(r.kind) < RANK.indexOf(old.kind)) merged.set(k, r);
  }
}
const rows = [...merged.values()].filter(r => r.kind !== '먹음');

const dead = rows.filter(r => r.kind === 'DEAD');
console.log(`\n== ${W}x${H}  안 먹은 선언 ${rows.length}  (` + RANK.slice(1).map(k => `${k} ${rows.filter(r => r.kind === k).length}`).join(' · ') + ')');
for (const k of RANK.slice(1))
  for (const r of rows.filter(r => r.kind === k))
    console.log(`  ${k.padEnd(5)} ${r.sel}  { ${r.p}: ${r.val ?? ''} }${k === 'DEAD' ? `  먹은 값 ${r.now} / 정한 값 ${r.want}` : ''}`);
ws.close(); await fetch('http://127.0.0.1:9222/json/close/' + t.id);
process.exitCode = dead.length ? 1 : 0;   // process.exit 는 소켓 닫는 중에 윈도우 node 를 죽인다
