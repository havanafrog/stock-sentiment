// 어느 세션이 지금 무엇을 하고 있나.
//
//   node ops/board.mjs            127.0.0.1:8730
//   node ops/board.mjs --port 9000
//   node ops/board.mjs --selftest
//
// 세션들은 서로 말을 안 한다. 각자 자기 기록만 남긴다. 그 기록이 한곳에 있어서
// 밖에서 읽으면 누가 무엇을 하는지 보인다 — 세션에 아무것도 안 붙이고 본다.
//
// 기록은 ~/.claude/projects/<폴더>/<세션>.jsonl 이다. 폴더 이름은 작업 경로에서
// 콜론과 역슬래시를 빼기로 바꾼 것이다.
//
// 밖으로 안 연다. 기록에는 대화가 통째로 들어 있다.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';   // 점검에서만 쓴다
import { tmpdir } from 'node:os';
import { readFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { read as readLedger, open as openClaims } from './ledger.mjs';
// ponytail: repo() 만 쓴다. facts.mjs 의 나머지(model·corpus·service·measure)는
// 이 저장소 전용이라 ops 판에서 뺐다. 플러그인으로 포장할 때 repo() 를 옮기면
// facts.mjs 는 통째로 안 따라간다.
import { repo } from './facts.mjs';
import { state as handoffState } from './handoff.mjs';
import { tally } from './cost.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);

/** 작업 경로 → 기록 폴더 이름. Claude 가 쓰는 규칙과 같아야 한다. */
export function projectSlug(cwd) {
  return cwd.replace(/[:\\/]/g, '-');
}

// 통 안에서는 작업 경로가 /repo 라 폴더 이름이 안 맞는다. 밖에서 정해 준다.
export const LOG_DIR = process.env.OPS_LOG_DIR
  || join(homedir(), '.claude', 'projects', projectSlug(REPO));

// 창 이름은 기록(jsonl)이 아니라 여기 있다. 한 창에 파일 하나, 파일 이름은 pid 다.
export const SESSION_DIR = process.env.OPS_SESSION_DIR
  || join(homedir(), '.claude', 'sessions');

/**
 * 사람이 창에 붙인 이름을 sessionId 로 찾을 수 있게 짝지어 준다.
 *
 * 한 세션을 이어서 열면 pid 가 달라 파일이 둘이 된다 — 나중에 고친 쪽이 이긴다.
 * nameSource 가 'user' 인 것만 쓴다. 그 밖은 클로드가 지은 이름이라, 그럴 바에는
 * 사람이 맨 처음 시킨 말이 어느 창인지 더 잘 알려 준다.
 */
export function sessionNames(dir = SESSION_DIR) {
  const best = new Map();
  for (const j of sessionFiles(dir)) {
    if (!j.name || j.nameSource !== 'user') continue;
    const at = j.updatedAt ?? 0;
    if ((best.get(j.sessionId)?.at ?? -1) >= at) continue;
    best.set(j.sessionId, { name: String(j.name).trim(), at });
  }
  return new Map([...best].map(([k, v]) => [k, v.name]));
}

/** 등록부의 .json 을 읽는다. 같은 폴더에 .key 도 살아서 확장자를 봐야 한다. */
function sessionFiles(dir = SESSION_DIR) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), 'utf8'))); }
    catch { /* 반쯤 쓰다 만 파일은 없던 셈 친다 */ }
  }
  return out.filter(j => j && j.sessionId);
}

// 경로의 마지막 칸. 통은 리눅스라 basename() 이 윈도우 역슬래시를 안 자른다.
const leaf = p => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? null;

/**
 * 지금 이 기계에 열려 있는 클로드 코드 창 전부. 저장소를 안 가린다.
 *
 * 기록(jsonl)이 아니라 등록부를 본다 — 창이 닫히면 클로드가 이 파일을 지우므로
 * 남아 있는 것이 곧 열린 창이다. 그래서 이 저장소 밖의 창도 여기서는 보인다.
 *
 * ponytail: 창이 죽으면서 파일을 못 지우면 유령이 남는다. 통 안에서 호스트 pid 는
 * 못 보니 지우지 않고, 마지막 기척(updatedAt)을 같이 내보내 화면에서 흐리게 깐다.
 */
export function liveSessions(dir = SESSION_DIR, mine = new Set()) {
  const best = new Map();
  for (const j of sessionFiles(dir)) {
    const at = j.updatedAt ?? j.startedAt ?? 0;
    if ((best.get(j.sessionId)?.updatedAt ?? -1) >= at) continue;
    best.set(j.sessionId, {
      pid: j.pid ?? null,
      id: j.sessionId,
      // 여기서는 클로드가 지은 이름도 쓴다. 창 카드와 달리 대체할 첫 요청이 없고,
      // 창 제목에는 어느 쪽이든 그 이름이 걸려서 눌러 찾는 데도 쓰인다.
      name: j.name ? String(j.name).trim() : null,
      named: j.nameSource === 'user',
      project: leaf(j.cwd),
      status: j.status ?? null,
      kind: j.kind ?? null,
      version: j.version ?? null,
      startedAt: j.startedAt ?? null,
      updatedAt: at,
      here: mine.has(j.sessionId),
    });
  }
  return [...best.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 한 줄에서 "무엇을 했나" 한 마디를 뽑는다. */
export function describe(row) {
  const m = row?.message;
  if (!m) return null;
  if (typeof m.content === 'string') {
    const t = m.content.trim();
    return t ? { role: m.role, kind: 'text', text: t } : null;
  }
  if (!Array.isArray(m.content)) return null;
  // 도구를 썼으면 그게 지금 하는 일이다. 글보다 도구가 먼저다.
  const tool = m.content.find(c => c.type === 'tool_use');
  if (tool) {
    return { role: m.role, kind: 'tool', tool: tool.name,
      text: tool.input?.description ?? tool.input?.command ?? tool.input?.file_path
        ?? tool.input?.pattern ?? tool.input?.prompt
        // 흐름 칸이 비면 카드가 휑하다. 도구마다 이름 다음으로 잘 알려 주는 칸을 준다.
        ?? tool.input?.query ?? tool.input?.url ?? tool.input?.action ?? '' };
  }
  const text = m.content.filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
  if (text) return { role: m.role, kind: 'text', text };
  if (m.content.some(c => c.type === 'tool_result')) return { role: m.role, kind: 'result', text: '' };
  return null;
}

/**
 * 꼬리 몇 줄만 읽는다. 기록이 수십 MB 까지 자라므로 통째로 읽으면 안 된다.
 * 끝에서 512KB 만 떠서 줄로 자른다.
 */
function tailLines(file, want = 400) {
  const size = statSync(file).size;
  const span = Math.min(size, 512 * 1024);
  const buf = Buffer.alloc(span);
  const h = openSync(file, 'r');
  try { readSync(h, buf, 0, span, size - span); } finally { closeSync(h); }
  const lines = buf.toString('utf8').split('\n');
  if (size > span) lines.shift();                // 첫 줄은 중간에서 잘렸다
  return lines.filter(Boolean).slice(-want);
}

/**
 * 머리 몇 줄. 세션 이름이 기록 어디에도 없어서 사람이 맨 처음 시킨 말을 이름으로 쓴다
 * — 여덟 자리 아이디보다 그게 어느 창인지 알려 준다.
 */
function headLines(file, want = 60) {
  const size = statSync(file).size;
  const span = Math.min(size, 128 * 1024);
  const buf = Buffer.alloc(span);
  const h = openSync(file, 'r');
  try { readSync(h, buf, 0, span, 0); } finally { closeSync(h); }
  const lines = buf.toString('utf8').split('\n');
  if (size > span) lines.pop();                  // 마지막 줄은 중간에서 잘렸다
  return lines.filter(Boolean).slice(0, want);
}

/**
 * 빗금 명령으로 연 세션은 첫 줄이 그 명령이다. `/ops verify` 처럼 꺼내 쓴다 —
 * 사람이 친 것이고, 그 창이 무슨 일을 하러 열렸는지 한눈에 보인다.
 */
export function commandOf(text) {
  const m = /<command-name>([^<]*)<\/command-name>/.exec(text ?? '');
  if (!m) return null;
  const a = /<command-args>([^<]*)<\/command-args>/.exec(text) ?? [, ''];
  return (m[1].trim() + ' ' + a[1].trim()).trim();
}

// 스킬을 부르면 그 안내문이 user 로 들어온다. 사람이 친 말이 아니다.
const NOT_HUMAN = [/^</, /^Caveat:/, /^Base directory for this skill:/];

/** 사람이 친 말인가. 훅·시스템·도구 결과가 user 로 들어오므로 걸러야 한다. */
function askedByHuman(d) {
  if (!d || d.role !== 'user' || d.kind !== 'text') return false;
  if (commandOf(d.text)) return true;              // 빗금 명령은 사람이 친 것이다
  return !NOT_HUMAN.some(re => re.test(d.text));
}

/** 화면에 걸 말. 빗금 명령이면 명령을, 아니면 그 말 그대로. */
function label(text) {
  return commandOf(text) ?? text;
}

/** 여러 줄 명령이 카드를 뚫는다. 공백을 한 칸으로 눕힌다. */
const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim();

const MOVING_MS = 20_000;      // 이 안에 기록이 늘었으면 움직이는 중
const STOPPED_MS = 10 * 60 * 1000;   // 이만큼 조용하면 멈춘 것으로 본다
const STEPS = 5;               // 카드에 걸 최근 수. 더 늘리면 카드가 길어져 못 읽는다
const STEP_CUT = 120;          // 한 수의 글 길이. 화면에서 또 자르지만 보낼 때 줄인다

// 훅(whoasked.mjs)이 적어 둔 "창마다 마지막으로 시킨 말". 기록 꼬리에서 찾는 것보다
// 이게 낫다 — 도구 결과 한 줄(스크린샷 같은)이 512KB 를 통째로 먹으면 사람이 친 말이
// 꼬리 밖으로 밀려나서 안 보인다. 실제로 그렇게 안 보였다.
// ponytail: 훅이 안 걸린 창은 여기 없다. 그때는 아래 기록 훑기로 떨어진다.
export const WHOASKED = process.env.OPS_WHOASKED ?? join(HERE, 'whoasked.json');

export function askedByHook(file = WHOASKED) {
  if (!existsSync(file)) return new Map();
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return new Map(Object.entries(j).map(([id, r]) => [id, r?.prompt]).filter(([, p]) => p));
  } catch { return new Map(); }
}

/**
 * 이 창이 지금 어느 칸에 있나.
 *
 * 창이 스스로 신고하는 값이 아니라 기록에서 뽑는다 — 죽은 창은 신고를 멈추지
 * 못하지만 기록 시각은 거짓말을 못 한다. 그래서 신고 파일을 따로 두지 않는다.
 *
 *   도는 중    방금 기록이 늘었다
 *   답 기다림  마지막이 창이 한 말이다 — 사람 차례라는 뜻
 *   응답 없음  사람이 시켰는데 아직 답이 없다. 생각 중이거나 승인 창이 떠 있다
 *   멈춤       오래 조용하다
 *
 * ponytail: 창이 닫혔는지는 안 가른다. 그러려면 등록부(SESSION_DIR)를 같이 봐야
 * 하는데, 통 안에서는 경로가 안 맞아 못 본다. 닫힌 창도 '멈춤' 으로 보인다.
 */
export function phaseOf(last, idle) {
  if (idle < MOVING_MS) return 'moving';
  if (idle >= STOPPED_MS) return 'stopped';
  return last?.role === 'assistant' ? 'waiting' : 'busy';
}

export function sessions(dir = LOG_DIR, now = Date.now()) {
  if (!existsSync(dir)) return [];
  const named = sessionNames();
  const hookAsked = askedByHook();
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const file = join(dir, f);
    const st = statSync(file);
    if (!st.isFile() || st.size === 0) continue;

    let rows = [];
    try { rows = tailLines(file).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
    catch { continue; }
    if (!rows.length) continue;

    // 마지막으로 "한 일". 도구 결과만 있는 줄은 건너뛴다 — 그건 남이 준 답이다.
    let last = null;
    for (let i = rows.length - 1; i >= 0 && !last; i--) {
      const d = describe(rows[i]);
      if (d && d.kind !== 'result') last = { ...d, at: rows[i].timestamp };
    }
    // 이 창이 최근에 한 수. 시간순으로 놓으면 무슨 흐름인지 보인다.
    // 사람 말은 안 담는다 — 그건 asked 로 따로 나가고, 흐름은 창이 한 일이다.
    const steps = [];
    for (let i = rows.length - 1; i >= 0 && steps.length < STEPS; i--) {
      const d = describe(rows[i]);
      if (!d || d.role !== 'assistant') continue;
      if (d.kind !== 'tool' && d.kind !== 'text') continue;
      steps.push({ kind: d.kind, tool: d.tool ?? null,
        text: squash(d.text).slice(0, STEP_CUT), at: rows[i].timestamp });
    }
    steps.reverse();

    // 사람이 마지막으로 시킨 것.
    let asked = null;
    for (let i = rows.length - 1; i >= 0 && !asked; i--) {
      const d = describe(rows[i]);
      if (askedByHuman(d)) asked = label(d.text);
    }
    // 맨 처음 시킨 것. 이게 이 창의 이름이 된다.
    let first = null;
    try {
      for (const l of headLines(file)) {
        let d = null;
        try { d = describe(JSON.parse(l)); } catch { continue; }
        if (askedByHuman(d)) { first = label(d.text); break; }
      }
    } catch { /* 머리를 못 읽어도 나머지는 보여 준다 */ }

    const idle = now - st.mtimeMs;
    const id = basename(f, '.jsonl');
    out.push({
      id,
      // 사람이 붙인 이름이 있으면 그게 이름이다 — 판에서 어느 창인지 그걸로 가른다.
      // 없으면 첫 요청, 그것도 없으면 아이디 앞 여덟 자.
      name: named.get(id)
        ?? (first ? first.replace(/\s+/g, ' ').trim().slice(0, 30) : (rows.find(r => r.slug)?.slug ?? null)),
      titled: named.has(id),
      first,
      branch: rows.find(r => r.gitBranch)?.gitBranch ?? null,
      turns: rows.filter(r => r.type === 'assistant').length,
      moving: idle < MOVING_MS,
      phase: phaseOf(last, idle),
      idleMs: idle,
      last,
      steps,
      // 토큰과 환산 금액. 늘어난 부분만 읽으므로 2초마다 불러도 싸다.
      cost: tally(file),
      // 훅이 적어 둔 것이 먼저다. 기록 훑기는 훅이 안 걸린 창을 위한 뒷자리다.
      asked: hookAsked.get(id) ?? asked,
    });
  }
  return out.sort((a, b) => a.idleMs - b.idleMs);
}

export function board(now = Date.now()) {
  const claims = openClaims();
  const all = readLedger();
  const sess = sessions(LOG_DIR, now);
  // 이 저장소 창인지는 등록부 경로로 못 가른다 — 통 안은 /repo 고 등록부는 윈도우
  // 경로다. 이 저장소 기록에 아이디가 있으면 여기 창이다.
  const live = liveSessions(SESSION_DIR, new Set(sess.map(s => s.id)));
  return {
    now,
    sessions: sess,
    live,
    // 이 저장소 창들이 쓴 것을 다 더한 값.
    spend: sess.reduce((a, s) => a + (s.cost?.usd ?? 0), 0),
    repo: repo(),
    // 넘길 게 남았나. Stop 훅이 보는 것과 같은 값이다.
    handoff: (() => { try { return handoffState(); } catch { return null; } })(),
    open: claims,
    recent: all.slice(-12).reverse(),
    counts: {
      claims: all.filter(r => r.kind === 'claim').length,
      verdicts: all.filter(r => r.kind === 'verdict').length,
      closed: all.filter(r => r.kind === 'claim').length - claims.length,
    },
  };
}

// ── 화면 ─────────────────────────────────────────────────────
// 부를 때마다 읽는다. 통은 화면 파일을 마운트해서 보므로, 뜰 때 한 번만 읽으면
// 고쳐도 통을 다시 세우기 전까지 옛 화면이 나간다 — 실제로 그렇게 한 번 속았다.
// 11KB 짜리 파일 하나다. 2초에 한 번 부르는 판에 걸릴 값이 아니다.
const PAGE = () => readFileSync(join(HERE, 'board.html'), 'utf8');

function main(argv) {
  const flag = (k, dflt) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : dflt; };
  const port = Number(flag('port', 8730));
  // 기본은 127.0.0.1 이다. 통 안에서만 0.0.0.0 으로 듣고, 밖으로는 compose 가
  // 127.0.0.1 에만 건다 — 기록에는 대화가 통째로 들어 있다.
  const host = flag('host', '127.0.0.1');

  createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/api/board') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(board()));
    }
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(PAGE());
    }
    res.writeHead(404).end();
    // 127.0.0.1 로만 듣는다. 기록에는 대화가 통째로 들어 있어서 밖에 열면 안 된다.
  }).listen(port, host, () => {
    console.log(`\n  http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}\n`);
    console.log(`  기록  ${LOG_DIR}`);
    console.log(`  장부  ${readLedger().length}줄\n`);
  });
}

// ── 자체 점검 ────────────────────────────────────────────────
function selftest() {
  let n = 0;
  const ok = (label, cond, extra = '') => {
    if (!cond) throw new Error(`${label}  ${extra}`);
    n++; console.log(`  PASS  ${label}`);
  };

  ok('경로를 폴더 이름으로', projectSlug('C:\\Users\\a\\b') === 'C--Users-a-b', projectSlug('C:\\Users\\a\\b'));
  ok('리눅스 경로도', projectSlug('/home/a/b') === '-home-a-b');

  const D = row => describe(row);
  ok('글은 글로', D({ message: { role: 'user', content: '안녕' } }).text === '안녕');
  ok('빈 글은 없는 것', D({ message: { role: 'user', content: '   ' } }) === null);

  // 도구가 글보다 먼저다 — 지금 무엇을 하는지가 무슨 말을 했는지보다 급하다.
  const both = D({ message: { role: 'assistant', content: [
    { type: 'text', text: '이제 돌려 봅니다' },
    { type: 'tool_use', name: 'Bash', input: { description: '점검 돌리기' } }] } });
  ok('도구가 글보다 먼저', both.kind === 'tool' && both.tool === 'Bash');
  ok('도구 설명을 뽑는다', both.text === '점검 돌리기');

  const cmd = D({ message: { role: 'assistant', content: [
    { type: 'tool_use', name: 'Bash', input: { command: 'git log' } }] } });
  ok('설명이 없으면 명령을', cmd.text === 'git log');

  ok('도구 결과는 결과로', D({ message: { role: 'user', content: [
    { type: 'tool_result', content: 'x' }] } }).kind === 'result');
  ok('모르는 줄은 null', D({}) === null && D({ message: {} }) === null);

  // 진짜 기록이 있으면 읽히는지만 본다. 없어도 점검은 통과해야 한다.
  const s = sessions();
  ok('기록을 읽는다', Array.isArray(s));
  if (s.length) {
    ok('세션마다 아이디가 있다', s.every(x => x.id && typeof x.moving === 'boolean'));
    ok('가장 최근이 먼저', s.every((x, i) => i === 0 || s[i - 1].idleMs <= x.idleMs));
  }

  // 창이 어느 칸에 있나. 기록 시각과 마지막 줄의 임자만 보고 가른다.
  const A = { role: 'assistant' }, U = { role: 'user' };
  ok('방금 늘었으면 도는 중', phaseOf(A, 1_000) === 'moving');
  ok('사람 말이 마지막이어도 방금이면 도는 중', phaseOf(U, 1_000) === 'moving');
  ok('창이 말하고 조용하면 답 기다림', phaseOf(A, 60_000) === 'waiting');
  ok('시켰는데 답이 없으면 응답 없음', phaseOf(U, 60_000) === 'busy');
  ok('오래 조용하면 멈춤', phaseOf(A, 20 * 60_000) === 'stopped');
  ok('멈춤이 답 기다림을 이긴다', phaseOf(A, STOPPED_MS) === 'stopped');
  ok('마지막 줄이 없어도 안 죽는다', phaseOf(null, 60_000) === 'busy');

  // 창 이름. 이어 연 세션은 pid 가 달라 파일이 둘이다 — 나중 것이 이겨야 한다.
  const tmp = join(tmpdir(), 'ops-names-' + process.pid);
  mkdirSync(tmp, { recursive: true });
  const put = (f, o) => writeFileSync(join(tmp, f), JSON.stringify(o));
  put('1.json', { sessionId: 'aaa', name: '옛 이름', nameSource: 'user', updatedAt: 1 });
  put('2.json', { sessionId: 'aaa', name: '새 이름', nameSource: 'user', updatedAt: 2 });
  put('3.json', { sessionId: 'bbb', name: '클로드가 지음', nameSource: 'auto', updatedAt: 9 });
  put('4.json', { sessionId: 'ccc', updatedAt: 9, cwd: 'C:\\Users\\x\\MAIN\\일본여행' });
  put('5.json', 'not json');
  put('6.key', 'json 이 아닌 짝 파일');
  const N = sessionNames(tmp);
  ok('사람이 붙인 이름을 읽는다', N.get('aaa') === '새 이름', JSON.stringify([...N]));
  ok('클로드가 지은 이름은 안 쓴다', !N.has('bbb'));
  ok('이름 없는 창은 건너뛴다', !N.has('ccc') && N.size === 1);
  ok('폴더가 없으면 빈 짝', sessionNames(join(tmp, 'nope')).size === 0);

  // 열린 창 목록. 이름 짝짓기와 달리 이름 없는 창도 담아야 한다 — 열려 있으니까.
  const L = liveSessions(tmp, new Set(['aaa']));
  ok('이름이 없어도 열린 창은 담는다', L.length === 3, L.map(x => x.id).join(','));
  ok('클로드가 지은 이름도 걸되 표시한다', L.find(x => x.id === 'bbb').name === '클로드가 지음'
     && L.find(x => x.id === 'bbb').named === false
     && L.find(x => x.id === 'aaa').named === true);
  ok('이름이 아예 없으면 null', L.find(x => x.id === 'ccc').name === null);
  ok('한 세션은 한 줄, 나중 것이 이긴다', L.filter(x => x.id === 'aaa').length === 1
     && L.find(x => x.id === 'aaa').updatedAt === 2);
  ok('이 저장소 창을 가려낸다',
     L.find(x => x.id === 'aaa').here && !L.find(x => x.id === 'bbb').here);
  ok('윈도우 경로에서 폴더 이름만', L.find(x => x.id === 'ccc').project === '일본여행',
     String(L.find(x => x.id === 'ccc').project));
  ok('기척이 새것부터', L.every((x, i) => i === 0 || L[i - 1].updatedAt >= x.updatedAt));
  ok('폴더가 없으면 빈 목록', liveSessions(join(tmp, 'nope')).length === 0);
  rmSync(tmp, { recursive: true, force: true });

  ok('빗금 명령을 꺼낸다',
     commandOf('<command-message>ops</command-message> <command-name>/ops</command-name>'
       + ' <command-args>verify</command-args>') === '/ops verify');
  ok('인자가 없으면 명령만', commandOf('<command-name>/clear</command-name>') === '/clear');
  ok('명령이 아니면 null', commandOf('그냥 말') === null && commandOf(null) === null);
  ok('빗금 명령은 사람이 친 것', askedByHuman({ role: 'user', kind: 'text',
     text: '<command-name>/ops</command-name>' }));
  ok('스킬 안내문은 사람이 친 게 아니다', !askedByHuman({ role: 'user', kind: 'text',
     text: 'Base directory for this skill: C:\\x' }));

  ok('훅이 넣은 user 는 사람이 친 게 아니다',
     !askedByHuman({ role: 'user', kind: 'text', text: '<system-reminder>x</system-reminder>' })
     && !askedByHuman({ role: 'user', kind: 'text', text: 'Caveat: 어쩌고' })
     && askedByHuman({ role: 'user', kind: 'text', text: '이거 고쳐줘' }));
  ok('도구 결과는 사람이 친 게 아니다', !askedByHuman({ role: 'user', kind: 'result', text: '' }));

  // 흐름. 카드가 이걸로 채워지므로 순서와 개수가 틀리면 화면이 거짓말을 한다.
  const flow = join(tmpdir(), 'ops-flow-' + process.pid);
  mkdirSync(flow, { recursive: true });
  const at = i => new Date(1_000_000_000_000 + i * 1000).toISOString();
  const flowRows = [
    { message: { role: 'user', content: [{ type: 'text', text: '이거 해줘' }] }, timestamp: at(0) },
    ...Array.from({ length: 7 }, (_, i) => ({ type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash',
        input: { command: 'echo ' + i } }] }, timestamp: at(i + 1) })),
    { message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] }, timestamp: at(9) },
  ];
  writeFileSync(join(flow, '11111111-2222-3333-4444-555555555555.jsonl'),
    flowRows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const F = sessions(flow)[0];
  ok('흐름은 다섯 수까지', F.steps.length === STEPS, String(F.steps.length));
  ok('흐름은 시간순', F.steps.every((s, i) => i === 0 || s.at >= F.steps[i - 1].at));
  ok('가장 최근 수가 끝에', F.steps.at(-1).text === 'echo 6', F.steps.at(-1).text);
  ok('도구 결과도 사람 말도 흐름이 아니다',
     F.steps.every(s => s.kind === 'tool' && s.tool === 'Bash'));
  rmSync(flow, { recursive: true, force: true });

  const bd = board();
  ok('판을 만든다', Array.isArray(bd.sessions) && Array.isArray(bd.open) && bd.counts);
  ok('저장소도 담는다', bd.repo && typeof bd.repo.branch === 'string' && Array.isArray(bd.repo.dirty));
  ok('장부 줄도 담는다', Array.isArray(bd.recent)
     && typeof bd.counts.claims === 'number' && typeof bd.counts.closed === 'number');
  ok('훅이 적어 둔 말을 읽는다', askedByHook(join(HERE, '없는파일.json')).size === 0);
  ok('넘길 게 남았는지도 담는다', bd.handoff === null || typeof bd.handoff.pending === 'boolean',
     JSON.stringify(bd.handoff));
  ok('쓴 돈도 담는다', typeof bd.spend === 'number' && bd.spend >= 0
     && bd.sessions.every(s => s.cost && typeof s.cost.usd === 'number'), String(bd.spend));
  // 저장소 전용 값은 이제 안 담는다. 들어오면 판이 다시 이 저장소에 묶인 것이다.
  ok('저장소 전용 값은 안 담는다',
     !('model' in bd) && !('corpus' in bd) && !('service' in bd), Object.keys(bd).join(','));


  console.log(`\n${n}개 점검 통과\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) { console.log('\n자체 점검\n'); selftest(); process.exit(0); }
  main(argv);
}
