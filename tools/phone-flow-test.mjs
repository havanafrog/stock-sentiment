// 폰에서 손가락으로 하는 핵심 동선이 실제로 되는지 본다.
//
// 눈으로 보는 것과 손가락이 닿는 것은 다르다 - 44px 판을 깔아도 옆 버튼이 가로채면
// 화면은 멀쩡해 보인다. 그래서 좌표로 눌러 결과를 확인한다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/phone-flow-test.mjs "http://127.0.0.1:8731/?k=<키>"
const URL_ = process.argv[2];
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const waiting = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
let bad = 0;
const ok = (l, c, x = '') => { if (!c) bad++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); };

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL_ });
await new Promise(r => setTimeout(r, 9000));

// 손가락 한 번 누르기
const tap = async (x, y) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await new Promise(r => setTimeout(r, 60));
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise(r => setTimeout(r, 2500));
};
const center = async sel => JSON.parse(await js(
  `JSON.stringify((()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
   e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();
   return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})())`));

// 1) 메인 판에서 줄을 눌러 실시간으로
const row = await center('#board tbody tr:nth-child(2)');
const want = await js("document.querySelector('#board tbody tr:nth-child(2)')?.querySelector('b,strong,.bt')?.textContent?.trim() || document.querySelector('#board tbody tr:nth-child(2)')?.textContent.trim().slice(0,6)");
await tap(row.x, row.y);
const onLive = await js("document.querySelector('#tabMain')?.getAttribute('aria-selected')");
ok('판에서 줄을 누르면 실시간으로', onLive === 'true', `보던 종목 ${want}`);
const shown = await js("document.querySelector('.tk')?.textContent.trim()");
ok('누른 종목이 열린다', String(want).includes(String(shown)), `${shown}`);

// 2) 지표 접기를 손가락으로 펴기
await js("document.querySelector('#tabMain').click()");
await new Promise(r => setTimeout(r, 1500));
const sum = await center('#foldInd > summary');
const openBefore = await js("document.querySelector('#foldInd').open");
await tap(sum.x, sum.y);
const openAfter = await js("document.querySelector('#foldInd').open");
ok('지표 접기를 손가락으로 연다', openBefore === false && openAfter === true);

// 3) 체크박스 하나 켜기 — 44px 판이 실제로 눌리나
// 체크 상태는 localStorage 에 남는다. 앞선 실행이 켜 놨으면 누르는 순간 꺼져서
// 시험이 들쭉날쭉해진다 — 누르기 전에 꺼 둔다.
await js("const i=document.querySelector('#masBox input'); if(i.checked){i.click();} 'ok'");
await new Promise(r => setTimeout(r, 800));
const cb = await center('#masBox label');
await tap(cb.x, cb.y - 14);                    // 글자 아래위 여백 쪽을 누른다
ok('체크박스 여백을 눌러도 켜진다', await js("document.querySelector('#masBox input')?.checked === true"));

// 4) 탭 줄이 스크롤해도 남아 있나
await js("window.scrollTo(0, 1200)");
await new Promise(r => setTimeout(r, 600));
const tabsTop = await js("Math.round(document.querySelector('.tabs').getBoundingClientRect().top)");
ok('스크롤해도 탭 줄이 화면에 있다', tabsTop >= 0 && tabsTop < 60, `top ${tabsTop}px`);

console.log(bad ? `\n  ${bad}개 실패\n` : '\n  모두 통과\n');
ws.close(); await fetch(`http://127.0.0.1:9222/json/close/${t.id}`);
process.exitCode = bad ? 1 : 0;   // process.exit 는 소켓 닫는 중에 윈도우 node 를 죽인다(127)
