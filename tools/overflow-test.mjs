// 화면 폭 밖으로 넘쳐 페이지를 옆으로 밀게 하는 요소를 탭마다 찾는다.
//
// 넘친 요소의 자식들까지 다 적으면 목록이 수백 줄이 된다. 조상이 이미 넘쳤거나
// 가로 스크롤 상자 안이면 건너뛰어 뿌리만 남긴다. 닫힌 <details> 안의 것은
// 크롬이 자리는 잡아 두지만 그려지지도 문서 폭에 들어가지도 않아서 뺀다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/overflow-test.mjs "http://127.0.0.1:8741/?k=<키>" 195 422 2
// 글자 200% 는 폭 195, 높이 422, 배율 2 로 흉내 낸다.
const URL_ = process.argv[2];
const W = +(process.argv[3] || 195), H = +(process.argv[4] || 422), DPR = +(process.argv[5] || 2);
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const w = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; w.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: W < 700 });
await send('Page.navigate', { url: URL_ });
await new Promise(r => setTimeout(r, 9000));
let bad = 0;
// 탭마다 두 번 잰다 — 처음 뜬 대로, 그리고 접기를 모두 편 뒤. 폰은 접기가 닫혀
// 있어 그 안의 넘침(기간 칸 등)은 사람이 펴야 드러난다.
for (const tab of ['#tabBoard', '#tabMain', '#tabAnalysis', '#tabPosts', '#tabHelp']) for (const open of [false, true]) {
  await js(`document.querySelector('${tab}').click()`);
  await new Promise(r => setTimeout(r, 1800));
  if (open) {
    const n = await js(`[...document.querySelectorAll('details:not([open])')].filter(d => d.getClientRects().length).map(d => d.open = true).length`);
    if (!n) continue;   // 펼 것이 없는 탭은 한 번이면 된다
    await new Promise(r => setTimeout(r, 500));
  }
  const res = JSON.parse(await js(`JSON.stringify((()=>{
    const vw=document.documentElement.clientWidth; const out=[];
    const nm=e=>e.id?'#'+e.id:e.tagName.toLowerCase()+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\\s+/).join('.'):'');
    for(const e of document.querySelectorAll('body *')){
      const r=e.getBoundingClientRect(); if(r.width<1||r.height<1||r.right<=vw+0.5)continue;
      const shut=e.closest('details:not([open])'); if(shut&&!e.closest('summary'))continue;
      let p=e.parentElement,skip=false;
      while(p&&p!==document.body){
        if(/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)||p.getBoundingClientRect().right>vw+0.5){skip=true;break}
        p=p.parentElement}
      if(skip)continue;
      const chain=[];let q=e;
      for(let i=0;i<4&&q;i++,q=q.parentElement){const qr=q.getBoundingClientRect();chain.push(nm(q)+'['+Math.round(qr.left)+'..'+Math.round(qr.right)+']')}
      out.push(chain.join(' < ')+' "'+(e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,24)+'"');
    }
    return {vw,scrollW:document.documentElement.scrollWidth,roots:out.slice(0,8)};})())`));
  const over = res.scrollW > res.vw;
  if (over) bad++;
  console.log(`  ${over ? 'FAIL' : 'PASS'}  ${tab}${open ? ' (접기 폄)' : ''}  문서 폭 ${res.scrollW} / 화면 ${res.vw}`);
  for (const r of res.roots) console.log('        ' + r);
}
console.log(bad ? `\n  ${bad}개 탭이 옆으로 밀린다\n` : '\n  모두 통과\n');
ws.close(); await fetch('http://127.0.0.1:9222/json/close/' + t.id);
process.exitCode = bad ? 1 : 0;   // process.exit 는 소켓 닫는 중에 윈도우 node 를 죽인다(127)
