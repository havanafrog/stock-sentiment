// 화면에 칠해진 글자마다 대비를 걷어 AA 에 못 미치는 것을 돌려주는 페이지 안 식.
// contrast-test(테마마다 새로 띄움)와 theme-flip-test(띄운 채 뒤집음)가 같이 쓴다.
export const probe = `JSON.stringify((()=>{
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
