// 번진 선언 찾기. 한 탭을 보고 쓴 규칙이 이름이 같은 다른 탭 요소에도 걸려 있는지 본다.
//
// 글 탭용 .pnote { margin: 10px 0 0 } 이 실시간 탭 평단 줄의 '선' 라벨에도 걸려,
// 라벨을 세우자 줄이 40 -> 49px 로 커진 적이 있다. 주석 구역으로는 못 가른다 —
// '글 탭' 머리 아래에 판·카드·폰 규칙이 다 섞여 있다. 그래서 실제로 먹는 곳을 잰다.
//
// 탭을 하나씩 열고, 규칙의 선언을 하나씩 빼 보아 그 탭 판(#view*) 안에서 값이
// 바뀌는 요소가 있으면 '그 탭에서 먹는다' 고 센다. 두 탭 이상에서 먹는 선언을
// 요소 이름과 함께 적는다. 일부러 같이 쓰는 것(.card, .seg 등)도 섞여 나오니
// 목록은 사람이 읽고 가른다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/bleed-css.mjs "http://127.0.0.1:8741/?k=<키>" [폭] [높이]
const URL_ = process.argv[2];
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844);
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const w = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; w.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 한 탭 판 안에서 먹는 선언마다 [규칙 번호, 선택자, 속성, 요소 이름] 을 돌려준다.
const MEASURE = view => `(() => {
  const root = document.querySelector('${view}'), out = [];
  const nm = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
  let n = 0;
  const walk = rules => { for (const r of rules) {
    if (r instanceof CSSMediaRule) { if (matchMedia(r.conditionText).matches) walk(r.cssRules); else n += r.cssRules.length; }
    else if (r instanceof CSSStyleRule) check(r, n++);
  } };
  const check = (r, k) => {
    let ts;
    try {
      ts = r.selectorText.split(/,(?![^(]*\\))/).flatMap(s => {
        const m = s.match(/::?(after|before|placeholder|details-content)\\s*$/);
        if (/::-webkit-/.test(s)) return [];
        const base = (m ? s.slice(0, m.index) : s).trim();
        return [...root.querySelectorAll(base)].filter(el => el.getClientRects().length || el.parentElement?.getClientRects().length)
          .map(el => [el, m ? '::' + m[1] : null]);
      });
    } catch { return; }
    if (!ts.length) return;
    const saved = r.style.cssText;
    const decls = saved.split(/;(?![^(]*\\))/).map(d => d.trim()).filter(Boolean).map(d => d.slice(0, d.indexOf(':')).trim());
    for (const p of decls) {
      if (/^(transition|--)/.test(p)) continue;
      const on = ts.map(([el, ps]) => getComputedStyle(el, ps).getPropertyValue(p));
      r.style.removeProperty(p);
      const hit = ts.findIndex(([el, ps], i) => getComputedStyle(el, ps).getPropertyValue(p) !== on[i]);
      r.style.cssText = saved;
      if (hit >= 0) out.push([k, r.selectorText, p, nm(ts[hit][0]) + (ts[hit][1] || '')]);
    }
  };
  for (const s of document.styleSheets) walk(s.cssRules);
  return out;
})()`;

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url: URL_ });
await sleep(9000);
await js(`document.head.insertAdjacentHTML('beforeend', '<style>*, *::before, *::after { transition: none !important; }</style>')`);

const hits = new Map();   // "번호|속성" -> { sel, p, tabs: {탭: 요소} }
for (const [tab, view, label] of [['#tabBoard', '#viewBoard', '판'], ['#tabMain', '#viewMain', '실시간'],
  ['#tabAnalysis', '#viewAnalysis', '분석'], ['#tabPosts', '#viewPosts', '글'], ['#tabHelp', '#viewHelp', '도움']]) {
  await js(`document.querySelector('${tab}').click()`);
  await sleep(2500);
  await js(`document.querySelectorAll('details').forEach(d => d.open = true)`);
  await sleep(300);
  for (const [k, sel, p, el] of await js(MEASURE(view)) || []) {
    const key = k + '|' + p;
    if (!hits.has(key)) hits.set(key, { k, sel, p, tabs: {} });
    hits.get(key).tabs[label] = el;
  }
}
// 다섯째 인자로 선택자 조각을 주면 그 규칙은 한 탭에서만 먹어도 보여 준다.
const only = process.argv[5];
const multi = [...hits.values()].filter(h => only ? h.sel.includes(only) : Object.keys(h.tabs).length > 1);
// 같은 규칙의 선언은 한 줄로 묶는다.
const byRule = new Map();
for (const h of multi) {
  const k = h.k + '|' + JSON.stringify(h.tabs);
  if (!byRule.has(k)) byRule.set(k, { sel: h.sel, ps: [], tabs: h.tabs });
  byRule.get(k).ps.push(h.p);
}
console.log(`\n== ${W}x${H}  두 탭 이상에서 먹는 선언 ${multi.length} (규칙 ${new Set(multi.map(h => h.k)).size})`);
for (const r of byRule.values())
  console.log(`  ${r.sel}  { ${r.ps.join(', ')} }\n      ` + Object.entries(r.tabs).map(([tb, el]) => `${tb}: ${el}`).join('  ·  '));
ws.close(); await fetch('http://127.0.0.1:9222/json/close/' + t.id);
