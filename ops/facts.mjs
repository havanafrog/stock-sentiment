// 시스템이 지금 어떤 상태인가.
//
// 판(board.mjs)이 세션만 보여 주면 반쪽이다. 누가 일하는지보다 무엇이 어떤
// 상태인지가 먼저다 — 어떤 모델이 서비스에 올라가 있고, 글이 언제까지 들어왔고,
// 커밋 안 된 게 뭐가 남아 있나.
//
// 모두 파일과 git 에서 읽는다. 값이 비싼 것(정확도)만 따로 재서 적어 둔다.
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = dirname(HERE);
const at = f => (existsSync(f) ? statSync(f).mtimeMs : null);

/** 같은 파일을 다시 안 읽는다. 판이 2초마다 부르는데 model.json 은 1.8MB 다. */
function memo(fn) {
  let key = null, val = null;
  return (...a) => {
    const k = a.join('|') + ':' + a.map(at).join(',');
    if (k !== key) { val = fn(...a); key = k; }
    return val;
  };
}

const git = (...a) => {
  try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { return null; }
};

export function repo() {
  // 구분자는 탭이다. 제목에 탭이 들어갈 일은 없지만, 들어가도 뒤가 제목으로 붙게
  // 앞 둘만 떼고 나머지를 다시 잇는다.
  const head = git('log', '-1', '--format=%h%x09%cI%x09%s');
  const [hash, when, ...rest] = (head ?? '').split('\t');
  const subject = rest.join('\t');
  const dirty = (git('status', '--porcelain') ?? '')
    .split('\n').filter(Boolean).map(l => ({ how: l.slice(0, 2).trim(), path: l.slice(3) }));
  // 앞서 있는 커밋. 원격이 없으면 null 이지 0 이 아니다 — 둘은 다른 뜻이다.
  const ahead = git('rev-list', '--count', '@{upstream}..HEAD');
  return {
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    head: hash ? { hash, subject, when } : null,
    dirty,
    ahead: ahead === null ? null : +ahead,
  };
}

// ── 분류기 ───────────────────────────────────────────────────
const MODEL = join(REPO, 'model.json');
const readModel = memo(f => {
  if (!existsSync(f)) return null;
  const st = statSync(f);
  // 어휘 수만 필요하다. 1.8MB 를 JSON.parse 하지 않고 구분자만 센다.
  const src = readFileSync(f, 'utf8');
  const m = /"v":"((?:[^"\\]|\\.)*)"/.exec(src);
  const vocab = m ? m[1].split('\\u0000').length : null;
  return { at: st.mtimeMs, bytes: st.size, vocab };
});

const countLabels = memo(f => {
  if (!existsSync(f)) return 0;
  try { return JSON.parse(readFileSync(f, 'utf8')).length; } catch { return 0; }
});

function countJsonl(f) {
  if (!existsSync(f)) return 0;
  const by = new Set();
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r.y && r.id != null) by.add(r.id); } catch { /* 잘린 줄 */ }
  }
  return by.size;
}

export const FACTS_FILE = join(HERE, 'facts.json');

export function model() {
  const m = readModel(MODEL);
  const d = p => join(REPO, 'docs', p);
  const labels = {
    slm: countLabels(d('labels-4000.json')) + countLabels(d('labels-holdout-12000.json')),
    read: countLabels(d('labels-read-150.json')),
    audit: countLabels(d('labels-audit-240.json')),
    mine: countJsonl(join(REPO, 'data', 'labels.jsonl')),
  };
  // 정확도는 재는 데 몇십 초 걸린다. 판이 부를 때마다 잴 수 없으니 적어 둔 것을 읽는다.
  let measured = null;
  if (existsSync(FACTS_FILE)) {
    try { measured = JSON.parse(readFileSync(FACTS_FILE, 'utf8')); } catch { /* 깨졌으면 없는 셈 */ }
  }
  return { ...(m ?? { at: null, bytes: 0, vocab: null }), labels, measured };
}

// ── 글 ───────────────────────────────────────────────────────
const dataDir = () => process.env.STOCK_DATA_DIR || join(REPO, 'data');

export function corpus() {
  const dir = dataDir();
  const tf = join(dir, 'tickers.json');
  let tickers = [];
  try { tickers = JSON.parse(readFileSync(tf, 'utf8')); } catch { /* 없으면 빈 목록 */ }

  const rows = tickers.map(t => {
    const posts = join(dir, `${t}.posts.json`);
    const live = join(dir, `${t}.live.jsonl`);
    return {
      t,
      // 글 수는 파일을 안 열고 크기로 짐작한다. 70만 건을 2초마다 파싱할 수 없다.
      bytes: existsSync(posts) ? statSync(posts).size : 0,
      at: at(posts),
      liveAt: at(live),
    };
  });
  const built = join(dir, 'data.js');
  return { dir, rows, builtAt: at(built), builtBytes: existsSync(built) ? statSync(built).size : 0 };
}

// ── 서비스 ───────────────────────────────────────────────────
// ssh 는 느리다. 판이 2초마다 부르는데 매번 걸면 화면이 멈춘다.
// 뒤에서 가끔 물어보고 마지막에 받은 답을 돌려준다.
let svc = { state: null, at: 0, asking: false };
const SVC_EVERY = 30_000;

export function service(now = Date.now()) {
  if (!svc.asking && now - svc.at > SVC_EVERY) {
    svc.asking = true;
    import('node:child_process').then(({ execFile }) => {
      execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', 'oracle-stock',
        "sudo docker ps --format '{{.Names}}\\t{{.Status}}'"],
      { timeout: 15_000 }, (err, out) => {
        svc = { state: err ? { error: '안 닿음' } : parseDocker(out), at: Date.now(), asking: false };
      });
    }).catch(() => { svc.asking = false; });
  }
  return { ...svc.state, checkedAt: svc.at || null };
}

export function parseDocker(out) {
  const rows = String(out ?? '').split('\n').filter(Boolean).map(l => {
    const [name, status] = l.split('\t');
    return { name, status, healthy: /healthy/.test(status ?? ''), up: /^Up/.test(status ?? '') };
  });
  return { rows };
}

// ── 잰 값 적어 두기 ──────────────────────────────────────────
/** tools/train-nb.mjs 출력에서 사람 자 정확도를 뽑아 facts.json 에 남긴다. */
export function parseMeasure(text) {
  const out = {};
  const m = /실제 글 분포로 다시 맞춤[^\n]*\n([\s\S]*)$/.exec(text);
  if (m) for (const line of m[1].split('\n')) {
    const g = /^\s*(SLM|분류기|사전)\s+([\d.]+)%/.exec(line);
    if (g) out[g[1]] = +g[2];
  }
  const even = /── 분류기 \(240건\) ──[\s\S]*?전체 정확도 ([\d.]+)%/.exec(text);
  if (even) out.분류기240 = +even[1];
  return Object.keys(out).length ? out : null;
}

export function measure() {
  const out = execFileSync(process.execPath, ['tools/train-nb.mjs'],
    { cwd: REPO, encoding: 'utf8', timeout: 600_000, maxBuffer: 8 << 20 });
  const acc = parseMeasure(out);
  if (!acc) throw new Error('출력에서 정확도를 못 찾았습니다. tools/train-nb.mjs 가 바뀌었나요?');
  const row = { ...acc, at: new Date().toISOString(), modelAt: at(MODEL) };
  writeFileSync(FACTS_FILE, JSON.stringify(row, null, 2));
  return row;
}
