// 띄운 채 시스템 테마를 뒤집어도 단추 글자가 읽히는지 본다.
//
// contrast-test 는 테마마다 새로 띄워 재므로 이 버그를 못 본다: 크롬은 색 전환이
// 걸린 속성을 테마가 바뀔 때 옛 값에 멈춰 둘 수 있다. 폰 글 탭의 고른 칩이 밝은
// 바탕에 흰 글자로 남아 대비 1.20 이 된 적이 있다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/theme-flip-test.mjs "http://127.0.0.1:8741/?k=<키>" [폭] [높이]
const URL_ = process.argv[2];
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844);
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const w = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; w.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });

// 보이는 단추마다 [이름, 대비]. 반투명 바탕은 밑과 섞어 잰다.
const measure = async () => JSON.parse(await js(`JSON.stringify((()=>{
  const lin=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
  const L=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  const parse=s=>{const m=(s.match(/[\\d.]+/g)||[0,0,0]).map(Number);return [m[0],m[1],m[2],m[3]===undefined?1:m[3]]};
  const bgOf=el=>{const st=[];let e=el;while(e){const c=parse(getComputedStyle(e).backgroundColor);if(c[3]>0)st.push(c);if(c[3]>=1)break;e=e.parentElement}
    let out=[255,255,255];for(let i=st.length-1;i>=0;i--){const c=st[i];out=[0,1,2].map(k=>c[k]*c[3]+out[k]*(1-c[3]))}return out};
  const cr=(f,b)=>{const l1=L(f),l2=L(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)};
  return [...document.querySelectorAll('.seg button, .tabs button')].filter(b=>b.getClientRects().length).map(b=>
    [(b.closest('[id]')?.id||'?')+' '+b.textContent.trim().slice(0,6), +cr(parse(getComputedStyle(b).color), bgOf(b)).toFixed(2)]);
})())`));

let bad = 0;
const ok = (l, c, x = '') => { if (!c) bad++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); };
for (const tab of ['#tabMain', '#tabPosts']) {
  for (const [from, to] of [['dark', 'light'], ['light', 'dark']]) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: from }] });
    await send('Page.navigate', { url: URL_ });
    await new Promise(r => setTimeout(r, 9000));
    await js(`document.querySelector('${tab}').click()`);
    await new Promise(r => setTimeout(r, 1800));
    // 뒤집기 전에 한 번 재야 한다. 헤드리스는 그림을 안 그려 색을 계산해 두지
    // 않는다 — 계산된 옛 색이 없으면 전환이 걸릴 것도 없어 버그가 안 드러난다.
    await measure();
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: to }] });
    await new Promise(r => setTimeout(r, 1500));   // 전환이 끝나고도 남을 만큼
    const low = (await measure()).filter(([, r]) => r < 4.5);
    ok(`${tab} ${from} -> ${to} 뒤집은 뒤 단추 글자 AA`, !low.length, low.map(([n, r]) => `${n} ${r}`).join(', '));
  }
}
console.log(bad ? `\n  ${bad}개 실패\n` : '\n  모두 통과\n');
ws.close(); await fetch('http://127.0.0.1:9222/json/close/' + t.id);
process.exitCode = bad ? 1 : 0;   // process.exit 는 소켓 닫는 중에 윈도우 node 를 죽인다(127)
