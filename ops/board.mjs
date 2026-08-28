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
import { readFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { read as readLedger, open as openClaims } from './ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);

/** 작업 경로 → 기록 폴더 이름. Claude 가 쓰는 규칙과 같아야 한다. */
export function projectSlug(cwd) {
  return cwd.replace(/[:\\/]/g, '-');
}

export const LOG_DIR = join(homedir(), '.claude', 'projects', projectSlug(REPO));

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
        ?? tool.input?.pattern ?? tool.input?.prompt ?? '' };
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

const MOVING_MS = 20_000;      // 이 안에 기록이 늘었으면 움직이는 중

export function sessions(dir = LOG_DIR, now = Date.now()) {
  if (!existsSync(dir)) return [];
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
    out.push({
      id: basename(f, '.jsonl'),
      // 기록에 이름이 없다. 첫 요청을 이름으로 쓰고, 그것도 없으면 아이디 앞 여덟 자.
      name: first ? first.replace(/\s+/g, ' ').trim().slice(0, 30) : (rows.find(r => r.slug)?.slug ?? null),
      first,
      branch: rows.find(r => r.gitBranch)?.gitBranch ?? null,
      turns: rows.filter(r => r.type === 'assistant').length,
      moving: idle < MOVING_MS,
      idleMs: idle,
      last, asked,
    });
  }
  return out.sort((a, b) => a.idleMs - b.idleMs);
}

export function board(now = Date.now()) {
  const claims = openClaims();
  const all = readLedger();
  return {
    now,
    sessions: sessions(LOG_DIR, now),
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
const PAGE = readFileSync(join(HERE, 'board.html'), 'utf8');

function main(argv) {
  const pi = argv.indexOf('--port');
  const port = pi >= 0 ? Number(argv[pi + 1]) : 8730;

  createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/api/board') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(board()));
    }
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(PAGE);
    }
    res.writeHead(404).end();
    // 127.0.0.1 로만 듣는다. 기록에는 대화가 통째로 들어 있어서 밖에 열면 안 된다.
  }).listen(port, '127.0.0.1', () => {
    console.log(`\n  http://127.0.0.1:${port}\n`);
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

  const b = board();
  ok('판을 만든다', Array.isArray(b.sessions) && Array.isArray(b.open) && b.counts);

  console.log(`\n${n}개 점검 통과\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) { console.log('\n자체 점검\n'); selftest(); process.exit(0); }
  main(argv);
}
