// 차트 조작 회귀 시험. 확대·이동이 폰과 데스크톱에서 각각 되는지 본다.
//
// 손가락 확대는 눈으로만 봐서는 깨진 걸 모른다 - 한 번은 이동 손잡이가 확대를
// 가로채 가는데도 화면이 움직여서 멀쩡해 보였다. 그래서 봉 개수로 잰다.
//
// 헤드리스 크롬을 CDP 로 몰고 간다. 먼저 이렇게 띄워 두고 돌린다:
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<빈폴더> about:blank
//   node tools/chart-touch-test.mjs "http://127.0.0.1:8731/?k=<키>"
//
// 원래 주석: 폰(손가락)과 데스크톱(휠)을 각각 새 탭에서 본다.
//
// 한 탭에서 터치 흉내를 켰다 끄면 pointer:coarse 가 true 로 남는다. 앱이 그걸 보고
// 안내문을 고르므로, 데스크톱 판정을 같은 탭에서 하면 늘 폰으로 나온다 — 계기 탓이다.
// 그래서 판마다 새 탭을 연다.
//
//   node regress.mjs <url>
const URL_ = process.argv[2];

async function connect() {
  const t = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const waiting = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise(res => {
    const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const js = async expr => (await send('Runtime.evaluate',
    { expression: expr, returnByValue: true })).result?.result?.value;
  const close = async () => { ws.close(); await fetch(`http://127.0.0.1:9222/json/close/${t.id}`); };
  return { send, js, close };
}

let bad = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) bad++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

/** 실시간 탭을 연 새 창. touch 면 손가락 기계로 흉내 낸다. */
async function openApp(w, h, touch) {
  const c = await connect();
  await c.send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: touch });
  if (touch) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: URL_ });
  await new Promise(r => setTimeout(r, 9000));
  await c.js("document.querySelector('#tabMain').click()");
  await new Promise(r => setTimeout(r, 3500));
  c.bars = async () => {
    const s = await c.js("document.querySelector('#cBarNote').textContent");
    const m = String(s || '').match(/([0-9,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) : -1;
  };
  c.note = () => c.js("document.querySelector('#cBarNote').textContent");
  c.box = async () => JSON.parse(await c.js(
    "JSON.stringify((()=>{const r=document.querySelector('#cPrice').getBoundingClientRect();"
    + "return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width)}})())"));
  return c;
}

// ── 폰 ──
{
  const c = await openApp(390, 844, true);
  const b = await c.box();
  const touch = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  // 손가락은 차트 안에서 시작해야 한다. 밖에서 시작하면 앱이 무시한다 — 당연하다.
  const spread = async (from, to) => {
    await touch('touchStart', [{ x: b.x - from, y: b.y, id: 1 }, { x: b.x + from, y: b.y, id: 2 }]);
    for (let i = 1; i <= 4; i++) {
      const d = Math.round(from + (to - from) * i / 4);
      await touch('touchMove', [{ x: b.x - d, y: b.y, id: 1 }, { x: b.x + d, y: b.y, id: 2 }]);
      await new Promise(r => setTimeout(r, 120));
    }
    await touch('touchEnd', []);
    await new Promise(r => setTimeout(r, 500));
  };
  const near = Math.round(b.w * 0.08), far = Math.round(b.w * 0.42);

  const start = await c.bars();
  await spread(near, far);
  const inn = await c.bars();
  ok('손가락 벌리기 = 확대', inn < start, `${start} → ${inn}봉`);

  await spread(far, near);
  const out = await c.bars();
  ok('손가락 오므리기 = 축소', out > inn, `${inn} → ${out}봉`);

  ok('폰 안내문에 휠이 없다', !(await c.note()).includes('휠'));

  // 한 손가락은 이동이다. 폭은 그대로여야 한다.
  await spread(near, far);                       // 먼저 좁혀 둬야 밀 데가 있다
  const span = await c.bars();
  await touch('touchStart', [{ x: b.x + 60, y: b.y, id: 1 }]);
  for (const dx of [20, -20, -60]) {
    await touch('touchMove', [{ x: b.x + dx, y: b.y, id: 1 }]);
    await new Promise(r => setTimeout(r, 120));
  }
  await touch('touchEnd', []);
  await new Promise(r => setTimeout(r, 400));
  ok('한 손가락 끌기는 폭을 안 바꾼다', (await c.bars()) === span, `${span}봉 유지`);
  await c.close();
}

// ── 데스크톱 ──
{
  const c = await openApp(1280, 900, false);
  const b = await c.box();
  const w0 = await c.bars();
  await c.send('Input.dispatchMouseEvent',
    { type: 'mouseWheel', x: b.x, y: b.y, deltaX: 0, deltaY: -240, pointerType: 'mouse' });
  await new Promise(r => setTimeout(r, 700));
  ok('데스크톱 휠 확대', (await c.bars()) < w0, `${w0} → ${await c.bars()}봉`);
  ok('데스크톱 안내문은 휠', (await c.note()).includes('휠'));
  await c.close();
}

console.log(bad ? `\n  ${bad}개 실패\n` : '\n  모두 통과\n');
process.exit(bad ? 1 : 0);
