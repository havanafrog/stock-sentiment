// 화면에 실제로 칠해진 글자색·바탕색을 걷어 AA(4.5, 큰 글자 3)에 못 미치는 자리를 찾는다.
//
// CSS 를 읽어서는 알 수 없다 - 변수가 테마마다 갈리고, 반투명 바탕은 밑에 깔린 것과
// 섞여야 진짜 색이 나온다. 그래서 브라우저가 계산한 값을 그대로 걷는다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/contrast-test.mjs "http://127.0.0.1:8741/?k=<키>" 390 844 "#tabBoard,#tabMain,#tabPosts"
//
// 주의: manual:dark / manual:light 줄은 띄운 뒤에 테마를 뒤집은 값이라, 크롬이
// 전환 중인 속성을 갱신 안 해 옛 색이 남을 수 있다. 그 자체가 볼 거리이긴 하다.
const URL_ = process.argv[2];
const W = +(process.argv[3] || 390), H = +(process.argv[4] || 844);
const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const waiting = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
await new Promise(r => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise(res => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url: URL_ });
await new Promise(r => setTimeout(r, 9000));

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

const setTheme = v => js(v ? `document.documentElement.setAttribute('data-theme','${v}');'ok'` : `document.documentElement.removeAttribute('data-theme');'ok'`);
const tabs = process.argv[5] ? process.argv[5].split(',') : ['#tabBoard'];
for (const tab of tabs) {
  await js(`document.querySelector('${tab}').click();'ok'`);
  await new Promise(r => setTimeout(r, 1800));
  for (const [scheme, manual] of [['light', null], ['dark', null], ['light', 'dark'], ['dark', 'light']]) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await setTheme(manual);
    await new Promise(r => setTimeout(r, 400));
    const res = JSON.parse(await js(probe));
    console.log(`\n== ${tab} ${W}x${H} media:${scheme} manual:${manual || '-'} page:${res.page} doc:${res.doc} scrollW:${res.scrollW} ==`);
    for (const b of res.bad) console.log(`  ${String(b.ratio).padStart(5)}  ${b.color} on ${b.bg}  ${b.size}/${b.weight}  ${b.sel}  x${b.n}  "${b.text}"`);
    if (!res.bad.length) console.log('  (AA 미달 없음)');
  }
}
process.exit(0);
