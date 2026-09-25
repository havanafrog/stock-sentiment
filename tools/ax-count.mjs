// 화면 읽어 주는 도구(VoiceOver·TalkBack)가 받는 접근성 나무를 탭마다 센다.
//
// 눈으로는 구조가 보여도 읽기 도구에는 역할이 없으면 글자 덩어리일 뿐이다. 제목·
// 목록·탭판 수와 이름 없는 누를 것 수를 세어, 손가락으로 쓸어 넘기며 건너뛸
// 자리가 있는지 본다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/ax-count.mjs "http://127.0.0.1:8741/?k=<키>" [폭] [높이]
const URL_ = process.argv[2];
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844);
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const w = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; w.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url: URL_ });
await new Promise(r => setTimeout(r, 9000));
await send('Accessibility.enable');
let unnamed = 0;
const PRESS = ['button', 'checkbox', 'link', 'textbox', 'searchbox', 'tab', 'combobox', 'slider', 'switch'];
for (const tab of ['#tabBoard', '#tabMain', '#tabAnalysis', '#tabPosts', '#tabHelp']) {
  await js(`document.querySelector('${tab}').click()`);
  await new Promise(r => setTimeout(r, 1800));
  const live = (await send('Accessibility.getFullAXTree')).result.nodes.filter(n => !n.ignored);
  const n = r => live.filter(x => x.role?.value === r).length;
  const noName = live.filter(x => PRESS.includes(x.role?.value) && !(x.name?.value || '').trim());
  unnamed += noName.length;
  const heads = live.filter(x => x.role?.value === 'heading').map(x => (x.name?.value || '').replace(/\s+/g, ' ').slice(0, 28));
  console.log(`\n== ${tab}  노드 ${live.length} · 제목 ${heads.length} · 목록 ${n('list')}/항목 ${n('listitem')}`
    + ` · 탭 ${n('tab')}/탭판 ${n('tabpanel')} · main ${n('main')} · 이름 없는 누를 것 ${noName.length}`);
  for (const h of heads.slice(0, 4)) console.log(`     제목 "${h}"`);
  if (heads.length > 4) console.log(`     … 제목 ${heads.length - 4}개 더`);
}
// 이름 없는 누를 것은 읽기 도구가 '단추' 라고만 읽는다 — 그건 실패로 끝낸다.
ws.close(); await fetch('http://127.0.0.1:9222/json/close/' + t.id);
process.exitCode = unnamed ? 1 : 0;   // process.exit 는 소켓 닫는 중에 윈도우 node 를 죽인다(127)
