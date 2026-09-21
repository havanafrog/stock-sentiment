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

import { probe } from './contrast-probe.mjs';

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
    // 실패·빈 상태. 서버는 건드리지 않고 페이지 안에서만 만든다.
    ['실패', '#tabMain', `for (const k in LAST.tickers) LAST.tickers[k].error = 'HTTP 503 Service Unavailable (시험)';
      paint(LAST); BAR.err = 'HTTP 503 Service Unavailable (시험)'; drawBars()`],
    ['실패', '#tabBoard', `tkSay('✗ HTTP 503 Service Unavailable (시험)', 'no')`],
    ['빈 목록', '#tabPosts', `const q = document.querySelector('#pQ'); q.value = '없는말시험ㅁㄴㅇㄹ'; q.dispatchEvent(new Event('input'))`],
    // fetch 를 망가뜨리므로 맨 뒤에 둔다 — 다음 테마는 새로 불러온다.
    ['실패', '#tabPosts', `window.fetch = () => Promise.reject(new Error('Failed to fetch (시험)')); loadPosts(true)`],
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
    await new Promise(r => setTimeout(r, tab === '#tabPosts' ? 4000 : 800));   // 글은 다시 불러온다
    if (name === '라벨 모드')   // 글 셋에 긍정·중립·부정을 하나씩 눌린 모습으로
      await js(`[...document.querySelectorAll('#pList .plab')].slice(0, 3).forEach((p, i) =>
        p.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j))));'ok'`);
    const res = JSON.parse(await js(probe));
    // 딱지가 안 뜨면 '미달 없음' 은 잰 게 아니다 — 뜬 개수를 같이 적는다.
    const CHECK = {
      '차트 짚기#tabMain': `'값 딱지 ' + [...document.querySelectorAll('.xlab')].filter(t => t.getAttribute('opacity') === '1' && t.textContent).length + '개'`,
      '실패#tabMain': `'.err ' + [...document.querySelectorAll('.err')].filter(e => e.getClientRects().length).length + '개'`,
      '실패#tabBoard': `'tkMsg ' + JSON.stringify(document.querySelector('#tkMsg').textContent.slice(0, 12))`,
      '빈 목록#tabPosts': `'빈 안내 ' + document.querySelector('#pList').textContent.includes('조건에 맞는 글이 없습니다')`,
      '실패#tabPosts': `'실패 안내 ' + document.querySelector('#pCount').textContent.includes('불러오지 못했습니다')`,
    }[name + tab];
    const shown = CHECK ? ` · ${await js(CHECK)}` : '';
    console.log(`\n== [숨은 상태: ${name}] ${tab} ${W}x${H} media:${scheme} manual:${manual || '-'} scrollW:${res.scrollW}${shown} ==`);
    for (const b of res.bad) console.log(`  ${String(b.ratio).padStart(5)}  ${b.color} on ${b.bg}  ${b.size}/${b.weight}  ${b.sel}  x${b.n}  "${b.text}"`);
    if (!res.bad.length) console.log('  (AA 미달 없음)');
  }
}
// 탭을 닫고 끝낸다. process.exit 는 소켓 닫는 중에 윈도우 node 를 죽인다.
ws.close(); await fetch('http://127.0.0.1:9222/json/close/' + t.id);
