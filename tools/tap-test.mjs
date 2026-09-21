// 누를 자리 잣대. 실제로 손가락이 닿으면 눌리는 넓이를 잰다.
//
// getBoundingClientRect 는 ::after 로 넓힌 자리를 못 본다 — '전체 보기'를 16x14 라고
// 거짓으로 냈다. 그래서 단추 둘레 ±40px 를 1px 격자로 찍어 elementFromPoint 가 그
// 단추(또는 그 단추에 딸린 라벨)를 돌려주는 점만 모아 넓이를 잰다. 가로나 세로가
// 24px 미만이면 FAIL (WCAG 2.5.8 최소 24x24).
//
// 접기는 모두 편 상태로, 차트는 확대해서 '전체 보기'를 띄운 상태로 잰다.
// 입력칸에 딸린 라벨('평단', '선', '라벨', '미 동부 거래일')은 따로 세지 않는다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/tap-test.mjs "http://127.0.0.1:8741/?k=<키>" [폭] [높이]
const URL_ = process.argv[2];
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844);
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const w = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; w.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
if (W < 700) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL_ });
await sleep(9000);

// 페이지 안에서 돈다. 보이는 누를 것마다 화면 가운데로 굴려 놓고 격자를 찍는다.
const MEASURE = `(async () => {
  const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [tabindex]:not([tabindex="-1"])';
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.disabled) continue;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise(r => requestAnimationFrame(r));
    const r = el.getBoundingClientRect();
    const own = [el, ...(el.labels || [])];
    const mine = h => h && own.some(o => o.contains(h));
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
    for (let y = Math.floor(r.top - 40); y <= r.bottom + 40; y++)
      for (let x = Math.floor(r.left - 40); x <= r.right + 40; x++)
        if (mine(document.elementFromPoint(x, y))) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const name = (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''))
      + ' "' + (el.getAttribute('aria-label') || el.textContent || el.value || el.type || '').trim().replace(/\\s+/g, ' ').slice(0, 18) + '"';
    out.push({ name, box: Math.round(r.width) + 'x' + Math.round(r.height),
      hit: n ? (x1 - x0 + 1) + 'x' + (y1 - y0 + 1) : '0x0', w: n ? x1 - x0 + 1 : 0, h: n ? y1 - y0 + 1 : 0 });
  }
  window.scrollTo(0, 0);
  return out;
})()`;

let bad = 0;
for (const [tab, label] of [['#tabBoard', '판'], ['#tabMain', '실시간'], ['#tabPosts', '글']]) {
  await js(`document.querySelector('${tab}').click()`);
  await sleep(3000);
  await js(`document.querySelectorAll('details').forEach(d => d.open = true)`);
  if (tab === '#tabMain') await js(`BAR.view = [BAR.rows.length - 30, BAR.rows.length - 1]; drawBars()`);
  await sleep(800);
  const rows = await js(MEASURE);
  const fails = rows.filter(r => r.w < 24 || r.h < 24);
  bad += fails.length;
  console.log(`\n== ${label} (${W}x${H})  누를 것 ${rows.length} · FAIL ${fails.length}`);
  for (const r of fails) console.log(`  FAIL  ${r.name}  눌림 ${r.hit}  (상자 ${r.box})`);
  if (tab === '#tabMain') {
    const c = rows.find(r => r.name.startsWith('#cReset'));
    console.log(`  ${c ? '      ' : 'FAIL  '}'전체 보기' ${c ? '눌림 ' + c.hit + ' (상자 ' + c.box + ')' : '안 떴다'}`);
    if (!c) bad++;
  }
}
ws.close(); await fetch('http://127.0.0.1:9222/json/close/' + t.id);
console.log(bad ? `\n  ${bad}개 실패\n` : '\n  모두 통과\n');
process.exitCode = bad ? 1 : 0;   // process.exit 는 소켓 닫는 중에 윈도우 node 를 죽인다
