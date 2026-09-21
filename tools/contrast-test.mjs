// 화면에 실제로 칠해진 글자색·바탕색을 걷어 AA(4.5, 큰 글자 3)에 못 미치는 자리를 찾는다.
//
// CSS 를 읽어서는 알 수 없다 - 변수가 테마마다 갈리고, 반투명 바탕은 밑에 깔린 것과
// 섞여야 진짜 색이 나온다. 그래서 브라우저가 계산한 값을 그대로 걷는다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/contrast-test.mjs "http://127.0.0.1:8741/?k=<키>" 390 844 "#tabBoard,#tabMain,#tabPosts"
//
// 테마 넷(시스템 밝음·어두움 × 손으로 고른 어두움·밝음)을 각각 새로 띄워 잰다.
// 띄운 채로 테마만 뒤집으면 크롬이 전환 중인 속성을 갱신 안 해 옛 색이 남는다 —
// 그 상태의 값은 화면에 실제로 칠해진 값이 아니라 갱신 버그의 값이다.
const URL_ = process.argv[2];
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844);
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const waiting = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

await send('Page.enable');   // 새 문서 전에 스크립트를 박으려면 이 판이 켜져 있어야 한다
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });

const probe = `JSON.stringify((()=>{
  const lin=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
  const L=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
  const parse=s=>{const m=(s.match(/[\\d.]+/g)||[0,0,0]).map(Number);return [m[0],m[1],m[2],m[3]===undefined?1:m[3]]};
  // 반투명 바탕은 밑에 깔린 것과 실제로 섞어야 한다 — 알파를 무시하면 거짓 대비가 나온다.
  const bgOf=el=>{const st=[];let e=el;
    while(e){const c=parse(getComputedStyle(e).backgroundColor);if(c[3]>0)st.push(c);if(c[3]>=1)break;e=e.parentElement}
    let out=[255,255,255,1];
    for(let i=st.length-1;i>=0;i--){const c=st[i];out=[0,1,2].map(k=>c[k]*c[3]+out[k]*(1-c[3])).concat(1)}
    return out;};
  const cr=(f,b)=>{const a=f[3];const m=[0,1,2].map(i=>f[i]*a+b[i]*(1-a));const l1=L(m),l2=L(b);const hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05)};
  const seen=new Map();
  document.querySelectorAll('body *').forEach(el=>{
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0)return;
    const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
    if(!own)return;
    const r=el.getBoundingClientRect(); if(r.width<1||r.height<1)return;
    const fg=parse(cs.color), bg=bgOf(el);
    const ratio=+cr(fg,bg).toFixed(2);
    const big=(parseFloat(cs.fontSize)>=24)||(parseFloat(cs.fontSize)>=18.66&&+cs.fontWeight>=700);
    if(ratio>=(big?3:4.5))return;
    const key=el.tagName+'.'+el.className+'|'+cs.color+'|'+cs.fontSize;
    if(seen.has(key)){seen.get(key).n++;return;}
    seen.set(key,{sel:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).join('.'):''),
      text:(el.textContent||'').trim().slice(0,22),color:cs.color,bg:'rgb('+bg.slice(0,3).map(Math.round).join(',')+')',
      size:cs.fontSize,weight:cs.fontWeight,ratio,big,n:1});
  });
  return {page:getComputedStyle(document.body).backgroundColor,doc:document.documentElement.scrollHeight,
    scrollW:document.documentElement.scrollWidth,
    bad:[...seen.values()].sort((a,b)=>a.ratio-b.ratio)};
})())`;

const tabs = process.argv[5] ? process.argv[5].split(',') : ['#tabBoard'];
let injected = null;
for (const [scheme, manual] of [['light', null], ['dark', null], ['light', 'dark'], ['dark', 'light']]) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  // 손으로 고른 테마는 첫 그림 전에 박아야 한다 — 뒤에 붙이면 갱신 버그에 걸린다.
  if (injected) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected });
  injected = manual
    ? (await send('Page.addScriptToEvaluateOnNewDocument', {
        // 새 문서가 생기는 순간엔 <html> 이 아직 없다 — 생기자마자 박고 그만둔다.
        source: `new MutationObserver((m,o)=>{if(document.documentElement){
          document.documentElement.setAttribute('data-theme','${manual}');o.disconnect();}})
          .observe(document,{childList:true})` })).result?.identifier
    : null;
  // 박힌 값이 진짜 들어갔는지는 아래 page: 색으로 드러난다 — 안 들어가면 테마가 안 바뀐다.
  await send('Page.navigate', { url: URL_ });
  await new Promise(r => setTimeout(r, 9000));
  for (const tab of tabs) {
    await js(`document.querySelector('${tab}')?.click();'ok'`);
    await new Promise(r => setTimeout(r, 1800));
    // 자료에 따라 뜨고 안 뜨는 것(경보 알약 등)은 여섯째 인자의 JS 로 억지로 띄워 잰다.
    if (process.argv[6]) await js(process.argv[6] + ";'ok'");
    const res = JSON.parse(await js(probe));
    console.log(`\n== ${tab} ${W}x${H} media:${scheme} manual:${manual || '-'} page:${res.page} doc:${res.doc} scrollW:${res.scrollW} ==`);
    for (const b of res.bad) console.log(`  ${String(b.ratio).padStart(5)}  ${b.color} on ${b.bg}  ${b.size}/${b.weight}  ${b.sel}  x${b.n}  "${b.text}"`);
    if (!res.bad.length) console.log('  (AA 미달 없음)');
  }
}
process.exit(0);
