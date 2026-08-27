// 두 세션이 같이 쓰는 장부.
//
// 왜 파일인가: 메시지는 컨텍스트와 함께 죽는다. 어느 쪽이든 압축되면 무슨 주장을
// 했고 무슨 판정이 났는지 잊는다. 파일은 남는다. 사람도 나중에 읽을 수 있다.
//
// 한 줄에 한 사건. 나중 줄이 앞 줄을 덮지 않는다 — 판정이 뒤집힌 것도 기록이다.
//
//   claim    만든 쪽이 "이게 맞다" 고 내놓는다. 재는 방법을 같이 적는다.
//   verdict  재는 쪽이 직접 돌려 보고 확인 · 반박 · 보류 중 하나를 적는다.
//   note     둘 다 쓴다. 판정이 아닌 말.
import { appendFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LEDGER = join(HERE, 'ledger.jsonl');

export const VERDICTS = new Set(['확인', '반박', '보류']);
const ROLES = new Set(['builder', 'verifier']);

/** 한 주장에 판정이 세 번 오가면 멈춘다. 그 다음은 사람이 볼 자리다. */
export const MAX_ROUNDS = 3;

export function read(file = LEDGER) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 붙이는 중에 죽으면 마지막 줄이 잘린다 */ }
  }
  return out;
}

function write(row, file = LEDGER) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(row) + '\n');
  return row;
}

/** C1, C2, … 이미 쓴 번호는 다시 안 쓴다. */
export function nextId(rows) {
  let n = 0;
  for (const r of rows) {
    const m = /^C(\d+)$/.exec(r.id ?? '');
    if (m) n = Math.max(n, +m[1]);
  }
  return 'C' + (n + 1);
}

export function claim({ what, how, why = null, files = [] }, file = LEDGER) {
  if (!what || !how) throw new Error('claim 에는 what 과 how 가 둘 다 있어야 합니다 — 재는 방법 없는 주장은 못 잽니다.');
  const rows = read(file);
  return write({ id: nextId(rows), kind: 'claim', by: 'builder', what, how, why, files,
    at: new Date().toISOString() }, file);
}

export function verdict({ id, v, note, evidence = null, by = 'verifier' }, file = LEDGER) {
  if (!VERDICTS.has(v)) throw new Error(`판정은 ${[...VERDICTS].join(' · ')} 중 하나입니다.`);
  if (!ROLES.has(by)) throw new Error('by 는 builder 또는 verifier 입니다.');
  if (!note) throw new Error('판정에는 근거가 필요합니다. 무엇을 돌렸고 무엇이 나왔는지 적으세요.');
  const rows = read(file);
  if (!rows.some(r => r.id === id && r.kind === 'claim')) throw new Error(`${id} 라는 주장이 없습니다.`);
  return write({ id, kind: 'verdict', by, v, note, evidence, at: new Date().toISOString() }, file);
}

export function note({ id = null, by, text }, file = LEDGER) {
  if (!ROLES.has(by)) throw new Error('by 는 builder 또는 verifier 입니다.');
  return write({ id, kind: 'note', by, text, at: new Date().toISOString() }, file);
}

/**
 * 아직 안 끝난 주장.
 *
 * 끝난 것 = 마지막 판정이 확인이거나, 판정이 MAX_ROUNDS 번 오간 것.
 * 반박은 끝이 아니다 — 만든 쪽이 고치고 다시 내놓아야 한다.
 */
export function open(file = LEDGER) {
  const rows = read(file);
  const out = [];
  for (const c of rows.filter(r => r.kind === 'claim')) {
    const vs = rows.filter(r => r.id === c.id && r.kind === 'verdict');
    const last = vs[vs.length - 1] ?? null;
    if (last?.v === '확인') continue;
    out.push({ ...c, rounds: vs.length, last, stuck: vs.length >= MAX_ROUNDS });
  }
  return out;
}

export function history(id, file = LEDGER) {
  return read(file).filter(r => r.id === id);
}

// ── 보기 좋게 ────────────────────────────────────────────────
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s ?? '');

function render(rows) {
  return rows.map(r => {
    if (r.kind === 'claim') return `  ${r.id}  [주장]  ${r.what}\n        재는 법: ${r.how}`;
    if (r.kind === 'verdict') return `  ${r.id}  [${r.v}]  ${r.by}\n        ${short(r.note, 300)}`;
    return `  ${r.id ?? '—'}  [메모]  ${r.by}: ${short(r.text, 200)}`;
  }).join('\n');
}

// ── CLI ──────────────────────────────────────────────────────
function main(argv) {
  const cmd = argv[0];
  const flag = k => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : null; };

  if (cmd === 'claim') {
    const r = claim({ what: argv[1], how: flag('how'), why: flag('why'),
      files: (flag('files') ?? '').split(',').filter(Boolean) });
    console.log(`${r.id} 를 장부에 올렸습니다.\n${render([r])}`);
    return;
  }
  if (cmd === 'verdict') {
    const r = verdict({ id: argv[1], v: argv[2], note: argv[3], evidence: flag('evidence'),
      by: flag('by') ?? 'verifier' });
    const rounds = history(r.id).filter(x => x.kind === 'verdict').length;
    console.log(render([r]));
    if (r.v === '확인') console.log(`\n${r.id} 닫힘.`);
    else if (rounds >= MAX_ROUNDS) console.log(`\n${r.id} 이 ${rounds}번 오갔습니다. 사람에게 넘기세요.`);
    return;
  }
  if (cmd === 'note') {
    console.log(render([note({ id: flag('id'), by: flag('by') ?? 'builder', text: argv[1] })]));
    return;
  }
  if (cmd === 'open') {
    const rows = open();
    if (!rows.length) return console.log('열린 주장이 없습니다.');
    for (const c of rows) {
      console.log(`  ${c.id}  ${c.what}`);
      console.log(`        재는 법: ${c.how}`);
      if (c.files?.length) console.log(`        파일: ${c.files.join(' ')}`);
      if (c.last) console.log(`        지난 판정: [${c.last.v}] ${short(c.last.note, 160)}`);
      if (c.stuck) console.log(`        ${c.rounds}번 오갔습니다 — 사람에게 넘길 자리`);
    }
    return;
  }
  if (cmd === 'show') { console.log(render(history(argv[1]))); return; }
  if (cmd === 'log') { console.log(render(read())); return; }

  console.log(`장부 — 두 세션이 같이 쓴다.

  node ops/ledger.mjs claim "주장" --how "재는 명령" [--why "왜"] [--files a,b]
  node ops/ledger.mjs verdict C1 확인|반박|보류 "근거" [--evidence "출력"] [--by builder]
  node ops/ledger.mjs note "메모" [--id C1] [--by verifier]
  node ops/ledger.mjs open        아직 안 끝난 주장
  node ops/ledger.mjs show C1     한 건의 내력
  node ops/ledger.mjs log         전부
  node ops/ledger.mjs --selftest`);
}

// ── 자체 점검 ────────────────────────────────────────────────
function selftest() {
  const tmp = join(HERE, `.selftest-${process.pid}.jsonl`);
  let n = 0;
  const ok = (label, cond, extra = '') => {
    if (!cond) throw new Error(`${label}  ${extra}`);
    n++; console.log(`  PASS  ${label}`);
  };
  try {
    ok('빈 장부는 빈 배열', read(tmp).length === 0 && open(tmp).length === 0);

    const c1 = claim({ what: '분류기 56.3%', how: 'node tools/train-nb.mjs' }, tmp);
    ok('첫 번호는 C1', c1.id === 'C1');
    ok('주장은 열려 있다', open(tmp).length === 1 && open(tmp)[0].rounds === 0);

    const c2 = claim({ what: '두 번째', how: 'echo' }, tmp);
    ok('번호가 이어진다', c2.id === 'C2');

    verdict({ id: 'C1', v: '반박', note: '돌려보니 54% 나옴' }, tmp);
    ok('반박은 안 닫는다', open(tmp).some(c => c.id === 'C1'));
    ok('지난 판정을 들고 있다', open(tmp).find(c => c.id === 'C1').last.v === '반박');

    verdict({ id: 'C1', v: '확인', note: '시드 맞추니 56.3% 재현됨' }, tmp);
    ok('확인은 닫는다', !open(tmp).some(c => c.id === 'C1'));
    ok('뒤집힌 것도 남는다', history('C1', tmp).filter(r => r.kind === 'verdict').length === 2);

    // 세 번 오가면 사람 자리다. 두 세션이 서로 반박만 하며 도는 걸 막는다.
    for (let i = 0; i < MAX_ROUNDS; i++) verdict({ id: 'C2', v: '보류', note: '못 정하겠음 ' + i }, tmp);
    ok('세 번 오가면 멈춤 표시', open(tmp).find(c => c.id === 'C2').stuck === true);

    // 재는 방법 없는 주장은 못 잰다. 그런 건 주장이 아니라 소감이다.
    let threw = false;
    try { claim({ what: '좋아졌다' }, tmp); } catch { threw = true; }
    ok('재는 법이 없으면 거부', threw);

    threw = false;
    try { verdict({ id: 'C1', v: '좋음', note: 'x' }, tmp); } catch { threw = true; }
    ok('모르는 판정은 거부', threw);

    threw = false;
    try { verdict({ id: 'C1', v: '확인', note: '' }, tmp); } catch { threw = true; }
    ok('근거 없는 판정은 거부', threw);

    threw = false;
    try { verdict({ id: 'C99', v: '확인', note: 'x' }, tmp); } catch { threw = true; }
    ok('없는 주장에는 판정 못 붙임', threw);

    appendFileSync(tmp, '{"id":"C3","kind":"claim"');
    ok('잘린 줄은 건너뛴다', read(tmp).filter(r => r.kind === 'claim').length === 2);

    console.log(`\n${n}개 점검 통과\n`);
  } finally {
    try { unlinkSync(tmp); } catch { /* 이미 없으면 됐다 */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) { console.log('\n자체 점검\n'); selftest(); process.exit(0); }
  try { main(argv); } catch (e) { console.error(e.message); process.exit(1); }
}
