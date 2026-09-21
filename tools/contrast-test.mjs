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
    let cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0)return;
    // 숨긴 툴팁처럼 조상이 투명해도 안 보인다 — 안쪽 글자는 제 opacity 가 1 이다.
    for(let p=el.parentElement;p;p=p.parentElement)if(+getComputedStyle(p).opacity===0)return;
    // 빈 입력칸은 안내 글자(::placeholder)가 글자다. 기본 회색은 테마를 안 따라간다.
    const ph=el.matches('input[placeholder]:placeholder-shown, textarea[placeholder]:placeholder-shown');
    const own=ph||[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
    if(!own)return;
    const r=el.getBoundingClientRect(); if(r.width<1||r.height<1)return;
    let fg, bg=bgOf(el);
    if(ph){cs=getComputedStyle(el,'::placeholder');fg=parse(cs.color);fg[3]*=+cs.opacity;}
    // SVG 글자는 color 가 아니라 fill 로 칠한다. 색 칸(배지) 위에 얹혔으면 그 칸이 바탕이다.
    else if(el instanceof SVGElement){
      if(!/^rgb/.test(cs.fill))return;
      fg=parse(cs.fill);fg[3]*=+cs.fillOpacity;
      const rc=el.previousElementSibling;
      if(rc&&rc.tagName==='rect'){const rs=getComputedStyle(rc),f=parse(rs.fill),a=f[3]*rs.fillOpacity*rs.opacity;
        if(/^rgb/.test(rs.fill))bg=[0,1,2].map(k=>f[k]*a+bg[k]*(1-a)).concat(1);}
    }
    else fg=parse(cs.color);
    const ratio=+cr(fg,bg).toFixed(2);
    const big=(parseFloat(cs.fontSize)>=24)||(parseFloat(cs.fontSize)>=18.66&&+cs.fontWeight>=700);
    if(ratio>=(big?3:4.5))return;
    const cls=typeof el.className==='string'?el.className:el.getAttribute('class')||'';
    const key=el.tagName+'.'+cls+'|'+fg+'|'+bg+'|'+cs.fontSize+(ph?'|ph':'');
    if(seen.has(key)){seen.get(key).n++;return;}
    seen.set(key,{sel:el.tagName.toLowerCase()+(cls?'.'+cls.trim().split(/\\s+/).join('.'):'')+(el.id?'#'+el.id:'')+(ph?'::placeholder':''),
      text:(ph?el.placeholder:el.textContent||'').trim().slice(0,22),color:'rgba('+fg.map(v=>+v.toFixed(2)).join(',')+')',bg:'rgb('+bg.slice(0,3).map(Math.round).join(',')+')',
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
  // 평소엔 안 뜨는 상태. 기본으로 돌리면 못 보던 미달이 셋 다 여기서 나왔다.
  // 서버에는 아무것도 보내지 않는다 — 라벨 단추는 누르면 /api/label 로 저장되므로
  // 누르지 않고 aria-pressed 만 바꿔 눌린 모습을 만든다.
  for (const [name, tab, setup] of [
    ['경보', '#tabMain', `LAST.alert = 0; paint(LAST)`],           // 카드 곡소리 태그
    ['경보', '#tabBoard', `LAST.alert = 0; paint(LAST)`],          // 판 경보 알약
    ['라벨 모드', '#tabPosts', `document.querySelector('#pLabOn button[data-on="1"]').click()`],
    // 가격 차트 가운데를 짚은 채로 — 십자선과 그 값 딱지(.xlab on .xlabbg)가 뜬다.
    ['차트 짚기', '#tabMain', `document.querySelector('#cPrice').scrollIntoView({ block: 'center' })`],
  ]) {
    await js(`document.querySelector('${tab}').click();'ok'`);
    await new Promise(r => setTimeout(r, 1800));
    await js(setup + ";'ok'");
    if (name === '차트 짚기') {
      await new Promise(r => setTimeout(r, 400));
      const b = JSON.parse(await js(`JSON.stringify(document.querySelector('#cPrice').getBoundingClientRect())`));
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
      // 툴팁(#ctip)은 .app 밖이라 테마 변수를 못 받아 늘 1.06 으로 잡힌다(사람 답 대기).
      // 고치기 전까지 이 판에선 가린다 — 고치면 이 줄을 뺀다.
      await js(`document.querySelector('#ctip').style.opacity = 0;'ok'`);
    }
    await new Promise(r => setTimeout(r, name === '라벨 모드' ? 4000 : 800));
    if (name === '라벨 모드')   // 글 셋에 긍정·중립·부정을 하나씩 눌린 모습으로
      await js(`[...document.querySelectorAll('#pList .plab')].slice(0, 3).forEach((p, i) =>
        p.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j))));'ok'`);
    const res = JSON.parse(await js(probe));
    // 딱지가 안 뜨면 '미달 없음' 은 잰 게 아니다 — 뜬 개수를 같이 적는다.
    const shown = name === '차트 짚기' ? ` · 값 딱지 ${await js(`[...document.querySelectorAll('.xlab')].filter(t => t.getAttribute('opacity') === '1' && t.textContent).length`)}개` : '';
    console.log(`\n== [숨은 상태: ${name}] ${tab} ${W}x${H} media:${scheme} manual:${manual || '-'}${shown} ==`);
    for (const b of res.bad) console.log(`  ${String(b.ratio).padStart(5)}  ${b.color} on ${b.bg}  ${b.size}/${b.weight}  ${b.sel}  x${b.n}  "${b.text}"`);
    if (!res.bad.length) console.log('  (AA 미달 없음)');
  }
}
// 탭을 닫고 끝낸다. process.exit 는 소켓 닫는 중에 윈도우 node 를 죽인다.
ws.close(); await fetch('http://127.0.0.1:9222/json/close/' + t.id);
