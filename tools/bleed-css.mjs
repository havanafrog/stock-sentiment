// 번진 선언 찾기. 한 탭을 보고 쓴 규칙이 이름이 같은 다른 탭 요소에 걸려 있는지 본다.
//
// 글 탭 구역의 .pnote { margin: 10px 0 0 } 은 글 탭에 그런 요소가 없어 실시간 탭
// .pnote 에만 걸려, '0명' 을 10px 처지게 했다. 그래서 실제로 먹는 곳을 잰다:
// 탭을 하나씩 열고 규칙의 선언을 하나씩 빼 보아 그 탭 판(#view*) 안에서 값이
// 바뀌는 요소가 있으면 '그 탭에서 먹는다' 고 센다.
//
// 두 가지를 적는다.
//  1) 어긋남 — 규칙이 놓인 주석 구역의 탭에선 안 먹고 다른 탭에서만 먹는 것.
//     구역은 짧은 제목 주석(/* 글 탭 */, /* 종목 판. …)이고 이름의 낱말로 탭을
//     정한다(아래 SECTION). 구역이 탭과 상관없으면(폰 등) 건너뛴다.
//  2) 두 탭 이상에서 먹는 것 — .card·.seg 처럼 일부러 같이 쓰는 것도 섞여 나온다.
// 둘 다 사람이 읽고 가른다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/bleed-css.mjs "http://127.0.0.1:8741/?k=<키>" [폭] [높이] [선택자 조각]
// 선택자 조각을 주면 그 규칙은 한 탭에서만 먹어도 보여 준다.
import fs from 'node:fs';
const URL_ = process.argv[2];
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844), only = process.argv[5];

// 구역 이름 낱말 -> 탭. 위에서부터 먼저 맞는 것. null 은 탭과 상관없는 구역이라
// 거기 놓인 규칙은 어긋남을 안 본다 — '컨트롤'(.ctrl·.ctrls)은 판·실시간·글이 같이 쓴다.
const SECTION = [[/분석/, '분석'], [/글 탭/, '글'], [/종목|순번|곡소리/, '판'],
  [/차트|크로스헤어|실시간/, '실시간'], [/계산식/, '도움'], [/^(컨트롤|폰)$/, null]];
// 구역 머리 없이 '종목 추가' 아래에 놓인 화면 배치 규칙. 판 규칙이 아니라 탭 판을
// 짜는 것이라 어긋남에서 뺀다. 줄 번호는 고칠 때마다 밀려 선택자로 적는다.
const LAYOUT = new Set(['.rate', '.single', '#cards, #feed', '.rail', '#pulseCard', '.fold',
  '.fold > summary', '#foldOpts, #foldOpts::details-content', '#pLabOnWrap, #pLabWrap']);

// ── 소스 줄 찾기 ── 주석을 지우고 공백을 뺀 CSS 에서 규칙 선택자를 차례로 찾는다.
const src = fs.readFileSync(new URL('../live.html', import.meta.url), 'utf8');
const s0 = src.indexOf('<style>') + 7, css = src.slice(s0, src.indexOf('</style>', s0));
const line0 = src.slice(0, s0).split('\n').length;
const heads = [];   // [줄, 탭|null, 이름]
{
  const re = /^  \/\* ([^.—*\n]{1,12}?)\s*(\*\/|\.|—)/gm; let m;
  while ((m = re.exec(css))) {
    // 구역 안의 설명 주석('라벨 찍는 줄.' 등)도 짧은 제목처럼 생겼다 — 탭 낱말이 든
    // 제목과 '폰'(탭과 상관없는 구역)만 구역을 바꾼다.
    const name = m[1].trim(), hit = SECTION.find(([r]) => r.test(name));
    if (!hit) continue;
    const tab = hit[1];
    heads.push([line0 + css.slice(0, m.index).split('\n').length - 1, tab, name]);
  }
}
const bare = css.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '));
let flat = '', lines = [];
{ let ln = line0; for (const ch of bare) { if (ch === '\n') ln++; if (!/\s/.test(ch)) { flat += ch; lines.push(ln); } } }
let cursor = 0;
const locate = sel => {
  const k = flat.indexOf(sel.replace(/\s+/g, '') + '{', cursor);
  if (k < 0) return null;
  cursor = k + 1;
  return lines[k];
};

// ── 브라우저 ──
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const w = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; w.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 모든 스타일 규칙을 소스 순서로 번호 매긴다(안 맞는 미디어 안의 것도 센다 — 소스 줄과 맞추려고).
const WALK = `const all = []; const walk = (rules, live) => { for (const r of rules) {
    if (r instanceof CSSMediaRule) walk(r.cssRules, live && matchMedia(r.conditionText).matches);
    else if (r instanceof CSSStyleRule) all.push([r, live]);
  } }; walk(document.querySelector('style').sheet.cssRules, true);`;

// 한 탭 판 안에서 먹는 선언마다 [규칙 번호, 속성, 요소 이름] 을 돌려준다.
const MEASURE = view => `(() => { ${WALK}
  const root = document.querySelector('${view}'), out = [];
  const nm = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
  all.forEach(([r, live], k) => {
    if (!live) return;
    let ts;
    try {
      ts = r.selectorText.split(/,(?![^(]*\\))/).flatMap(s => {
        if (/::-webkit-/.test(s)) return [];
        const m = s.match(/::?(after|before|placeholder|details-content)\\s*$/);
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
      if (hit >= 0) out.push([k, p, nm(ts[hit][0]) + (ts[hit][1] || '')]);
    }
  });
  return out;
})()`;

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url: URL_ });
await sleep(9000);
await js(`document.head.insertAdjacentHTML('beforeend', '<style>*, *::before, *::after { transition: none !important; }</style>')`);

const sels = await js(`(() => { ${WALK} return all.map(([r]) => r.selectorText); })()`);
const rules = sels.map(sel => {
  const ln = locate(sel), h = ln ? heads.filter(([l]) => l <= ln).at(-1) : null;
  return { sel, ln, sec: h?.[2] ?? '-', secTab: h?.[1] ?? null, tabs: {}, ps: {} };
});

for (const [tab, view, label] of [['#tabBoard', '#viewBoard', '판'], ['#tabMain', '#viewMain', '실시간'],
  ['#tabAnalysis', '#viewAnalysis', '분석'], ['#tabPosts', '#viewPosts', '글'], ['#tabHelp', '#viewHelp', '도움']]) {
  await js(`document.querySelector('${tab}').click()`);
  await sleep(2500);
  await js(`document.querySelectorAll('details').forEach(d => d.open = true)`);
  await sleep(300);
  for (const [k, p, el] of await js(MEASURE(view)) || []) {
    rules[k].tabs[label] ??= el;
    (rules[k].ps[label] ??= new Set()).add(p);
  }
}

const show = r => `  ${r.ln ?? '?'}줄 [${r.sec}] ${r.sel}\n      ` +
  Object.entries(r.tabs).map(([tb, el]) => `${tb}: ${el} { ${[...r.ps[tb]].join(', ')} }`).join('  ·  ');
const used = rules.filter(r => Object.keys(r.tabs).length);
const miss = used.filter(r => r.secTab && !r.tabs[r.secTab] && !LAYOUT.has(r.sel));
const multi = used.filter(r => only ? r.sel.includes(only) : Object.keys(r.tabs).length > 1);
console.log(`\n== ${W}x${H}  규칙 ${rules.length} (소스 줄 못 찾음 ${rules.filter(r => !r.ln).length}) · 먹는 규칙 ${used.length}`);
console.log(`\n-- 어긋남: 구역의 탭에선 안 먹고 다른 탭에서만 먹는다 ${miss.length}`);
for (const r of miss) console.log(show(r));
console.log(`\n-- ${only ? `'${only}' 가 든 규칙` : '두 탭 이상에서 먹는다'} ${multi.length}`);
for (const r of multi) console.log(show(r));
ws.close(); await fetch('http://127.0.0.1:9222/json/close/' + t.id);
