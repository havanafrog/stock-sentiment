// 판에서 세션을 누르면 그 창을 앞으로 가져오는 도우미.
//
//   node ops/focus.mjs            127.0.0.1:8732
//   node ops/focus.mjs --selftest
//
// 왜 따로 있나: 판은 통(컨테이너) 안에 산다. 통은 호스트 창을 못 건드린다.
// 브라우저도 프로그램을 못 띄운다. 그래서 호스트에서 도는 것이 하나 있어야 한다.
// 브라우저는 호스트에 있으므로 판 화면이 이 주소를 직접 부를 수 있다.
//
// 창을 어떻게 찾나: 세션의 pid 로는 못 찾는다 — 실측해 보니 claude.exe 도 그
// 부모 cmd.exe 도 MainWindowHandle 이 0 이다. 진짜 창은 Windows Terminal
// (CASCADIA_HOSTING_WINDOW_CLASS) 이 갖고 있고, 창 하나에 pid 는 하나뿐이라
// 세 세션이 전부 같은 pid 를 가리킨다. 남는 단서는 창 제목뿐이다 — Claude Code 가
// 세션 이름을 제목에 그대로 건다: "◐ [검증용_ops]".
//
// ponytail: 제목으로 찾는다. 같은 이름을 둘 붙이면 먼저 찾은 쪽이 뜬다.
// 이름이 겹쳐서 곤란해지면 그때 pid→conhost 짝짓기를 더한다.

import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 통이 아니라 호스트에서 돈다. 되살릴 창은 이 저장소에서 연다.
export const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

export const PORT = Number(process.env.OPS_FOCUS_PORT ?? 8732);

// 판이 사는 곳에서만 부를 수 있다. 아무 웹페이지나 남의 창을 올리면 안 된다.
const ALLOWED = new Set(['http://127.0.0.1:8730', 'http://localhost:8730']);

// 창 제목은 사람이 지은 이름이라 따옴표도 줄바꿈도 들어갈 수 있다. 명령 문자열에
// 끼워 넣지 않고 환경 변수로 넘긴다 — 끼워 넣기 사고가 아예 안 난다.
const PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;using System.Text;using System.Runtime.InteropServices;
public class OpsFocus {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  public static string Go(string needle) {
    IntPtr hit = IntPtr.Zero;
    EnumWindows((h,p) => { if (!IsWindowVisible(h)) return true;
      var t = new StringBuilder(300); GetWindowText(h, t, 300);
      if (t.ToString().Contains(needle)) { hit = h; return false; } return true; }, IntPtr.Zero);
    if (hit == IntPtr.Zero) return "notfound";
    if (IsIconic(hit)) ShowWindow(hit, 9);   // 내려놨으면 펴고
    SwitchToThisWindow(hit, true);           // 앞으로. SetForegroundWindow 는
    return "ok";                             // 뒤에 있는 프로그램이 부르면 씹힌다
  }
}
"@
[OpsFocus]::Go($env:OPS_FOCUS_NEEDLE)
`;

/** 제목에 이 말이 든 창을 앞으로. 'ok' 아니면 'notfound'. */
export function focus(needle) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve('unsupported');
    if (!needle || !needle.trim()) return resolve('noname');
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS],
      { env: { ...process.env, OPS_FOCUS_NEEDLE: needle }, timeout: 8000 },
      (err, out) => resolve(err ? 'failed' : (String(out).trim() || 'failed')));
  });
}

// 세션 아이디는 UUID 다. 이 꼴이 아니면 명령에 안 끼운다 — 끼워 넣기 사고를 막는다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 꺼진 창을 새 cmd 창에서 되살린다.
 *
 * 창이 살아 있으면 focus 가 먼저 잡으므로 여기까지 안 온다. 살아 있는 세션을
 * 또 열면 Claude 가 붙지 못한다 — 그래서 순서가 중요하다.
 */
export function open(id) {
  if (process.platform !== 'win32') return 'unsupported';
  if (!UUID.test(id ?? '')) return 'badid';
  try {
    // start 의 첫 인자는 창 제목이다. 비워 두면 경로를 제목으로 오해하지 않는다.
    spawn('cmd', ['/c', 'start', '', 'cmd', '/k', `claude --resume ${id}`],
      { cwd: REPO, detached: true, stdio: 'ignore' }).unref();
    return 'opened';
  } catch { return 'failed'; }
}

export function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    res.writeHead(403).end('판에서만 부를 수 있습니다');
    return null;                              // 부른 곳이 판이 아니다
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/go') { res.writeHead(404).end('/go?name=...&id=...'); return null; }
  return { name: url.searchParams.get('name') ?? '', id: url.searchParams.get('id') ?? '' };
}

export function main() {
  const srv = createServer(async (req, res) => {
    const q = handler(req, res);
    if (q === null) return;                   // handler 가 이미 답했다
    // 살아 있는 창이 먼저다. 못 찾았을 때만 되살린다 — 순서가 뒤집히면
    // 이미 도는 세션을 또 열어서 둘 다 못 쓰게 된다.
    let r = await focus(q.name);
    if (r !== 'ok' && q.id) r = open(q.id);
    res.writeHead(r === 'ok' || r === 'opened' ? 200 : 404,
      { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: r }));
  });
  // 127.0.0.1 에만 건다. 남의 기계에서 내 창을 올릴 일은 없다.
  srv.listen(PORT, '127.0.0.1', () => console.log(`창 도우미 http://127.0.0.1:${PORT}`));
}

export function selftest() {
  let n = 0;
  const ok = (what, cond, extra = '') => {
    n++;
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? '  ' + extra : ''}`);
    if (!cond) process.exitCode = 1;
  };
  const fake = () => {
    const res = { code: 0, body: '', headers: {} };
    return Object.assign(res, {
      setHeader: (k, v) => { res.headers[k.toLowerCase()] = v; },
      writeHead(c) { res.code = c; return res; },
      end(b) { res.body = String(b ?? ''); },
    });
  };

  const from = 'http://127.0.0.1:8730';
  let r = fake();
  ok('이름과 아이디를 꺼낸다', JSON.stringify(
     handler({ url: '/go?name=%5Bui%5D&id=abc', headers: {} }, r)) === '{"name":"[ui]","id":"abc"}');

  r = fake();
  ok('다른 길은 404', handler({ url: '/nope', headers: {} }, r) === null && r.code === 404);

  r = fake();
  ok('남의 페이지는 막는다',
     handler({ url: '/go?name=x', headers: { origin: 'https://evil.example' } }, r) === null
     && r.code === 403);

  r = fake();
  ok('판에서 온 것은 통과',
     handler({ url: '/go?name=x', headers: { origin: from } }, r).name === 'x'
     && r.headers['access-control-allow-origin'] === from);

  // 되살리기는 UUID 만 받는다. 아니면 명령에 안 끼운다.
  ok('아이디가 UUID 가 아니면 안 연다', open('x; calc') === 'badid');
  ok('빈 아이디도 안 연다', open('') === 'badid' && open(null) === 'badid');

  // 이름이 비면 창을 뒤지지도 않는다 — 빈 말은 아무 창에나 걸린다.
  focus('').then(v => {
    ok('빈 이름은 안 찾는다', v === 'noname' || v === 'unsupported', v);
    console.log(`\n${n}개 점검 통과\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--selftest')) { console.log('\n자체 점검\n'); selftest(); }
  else main();
}
