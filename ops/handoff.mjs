// 장부에 답이 올라오면 상대에게 넘긴다.
//
// 스킬에 "판정을 남기고 SendMessage 하라" 고 적어 뒀지만 그건 부탁이다. 잊으면
// 상대는 자기가 할 일이 생긴 줄 모르고 가만히 있고, 사람이 양쪽을 보다가
// "이제 네 차례" 라고 말해 줘야 한다. 그 사람을 뺀다.
//
// Stop 훅으로 건다. 턴을 끝내려 할 때 장부의 마지막 주장·판정이 아직 안 넘어갔으면
// 끝내지 못하게 막고, 무엇을 해야 하는지 알려 준다.
//
//   node ops/handoff.mjs check   넘길 게 남았나 (훅이 부른다)
//   node ops/handoff.mjs done    넘겼다고 표시
//   node ops/handoff.mjs state   지금 상태만 본다
//
// 한 줄에 한 번만 막는다. 못 넘기는 사정이 있어도 세션이 갇히면 안 된다.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { read, claim, verdict, note } from './ledger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MARK = process.env.OPS_HANDOFF || join(HERE, '.handoff.json');

/** 넘겨야 하는 줄. 메모는 아니다 — 메모는 상대가 답할 것이 없다. */
const NEEDS = new Set(['claim', 'verdict']);

export function newest(rows) {
  for (let i = rows.length - 1; i >= 0; i--) if (NEEDS.has(rows[i].kind)) return rows[i];
  return null;
}

function markOf(file = MARK) {
  if (!existsSync(file)) return { at: null, nudgedFor: null };
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { at: null, nudgedFor: null }; }
}

/**
 * 지금 넘길 게 있나.
 *
 *   pending  마지막 주장·판정이 표시된 것보다 나중이다
 *   nudged   이 줄로 이미 한 번 막았다 — 또 막으면 갇힌다
 */
export function state(file = MARK, ledgerFile) {
  const rows = ledgerFile ? read(ledgerFile) : read();
  const row = newest(rows);
  const m = markOf(file);
  return {
    row,
    pending: !!row && row.at !== m.at,
    nudged: !!row && row.at === m.nudgedFor,
    mark: m,
  };
}

export function done(file = MARK, ledgerFile) {
  const row = newest(ledgerFile ? read(ledgerFile) : read());
  if (!row) return null;
  const m = markOf(file);
  writeFileSync(file, JSON.stringify({ at: row.at, id: row.id, kind: row.kind,
    nudgedFor: m.nudgedFor }, null, 2));
  return row;
}

/** 막을 때 상대에게 뭐라고 할지. 사람이 아니라 세션이 읽는 말이다. */
export function message(row) {
  const who = row.by === 'builder' ? '재는 쪽' : '만드는 쪽';
  const what = row.kind === 'claim'
    ? `${row.id} 주장을 올렸습니다`
    : `${row.id} 에 [${row.v}] 판정을 남겼습니다`;
  return [
    `장부에 ${what}. 아직 ${who}에게 안 넘겼습니다.`,
    '',
    'ListAgents 로 상대를 찾아 SendMessage 로 한 줄 보내세요.',
    '장부에 적은 것을 되풀이하지 마세요 — 상대도 장부를 읽습니다.',
    `  예: "${row.id} ${row.kind === 'claim' ? '올렸습니다' : row.v}. 장부 보세요."`,
    '',
    '보낸 뒤 `node ops/handoff.mjs done` 을 돌리세요.',
    '상대가 없거나 보낼 수 없으면 사람에게 말하고, 그때도 done 을 돌려 표시하세요.',
  ].join('\n');
}

// ── CLI ──────────────────────────────────────────────────────
function main(argv) {
  const cmd = argv[0] ?? 'check';

  if (cmd === 'done') {
    const r = done();
    console.log(r ? `${r.id} 넘김 표시.` : '장부에 넘길 게 없습니다.');
    return 0;
  }

  const s = state();
  if (cmd === 'state') {
    console.log(JSON.stringify({ pending: s.pending, nudged: s.nudged,
      last: s.row && { id: s.row.id, kind: s.row.kind, by: s.row.by, at: s.row.at } }, null, 2));
    return 0;
  }

  if (!s.pending || s.nudged) return 0;

  // 이 줄로는 다시 안 막는다. 먼저 적고 나서 막는다 — 여기서 죽어도 갇히지 않는다.
  const m = markOf();
  writeFileSync(MARK, JSON.stringify({ ...m, nudgedFor: s.row.at }, null, 2));
  console.error(message(s.row));
  return 2;                            // Stop 훅에서 2 는 "끝내지 말고 이걸 읽어라"
}

// ── 자체 점검 ────────────────────────────────────────────────
function selftest() {
  let n = 0;
  const ok = (label, cond, extra = '') => {
    if (!cond) throw new Error(`${label}  ${extra}`);
    n++; console.log(`  PASS  ${label}`);
  };
  const tmpL = join(HERE, `.ho-ledger-${process.pid}.jsonl`);
  const tmpM = join(HERE, `.ho-mark-${process.pid}.json`);
  const S = () => state(tmpM, tmpL);

  try {
    ok('빈 장부는 넘길 게 없다', !S().pending && S().row === null);

    claim({ what: 'x', how: 'y' }, tmpL);
    ok('주장이 오면 넘길 게 생긴다', S().pending === true && S().row.kind === 'claim');
    ok('아직 안 막았다', S().nudged === false);

    done(tmpM, tmpL);
    ok('넘기면 사라진다', S().pending === false);

    verdict({ id: 'C1', v: '반박', note: '안 되던데요' }, tmpL);
    ok('판정이 와도 넘길 게 생긴다', S().pending === true && S().row.kind === 'verdict');

    // 메모는 상대가 답할 것이 없다.
    done(tmpM, tmpL);
    note({ id: 'C1', by: 'verifier', text: '곁다리' }, tmpL);
    ok('메모는 안 넘긴다', S().pending === false, JSON.stringify(S().row));

    // 한 줄에 한 번만 막는다 — 못 넘기는 사정이 있어도 갇히면 안 된다.
    verdict({ id: 'C1', v: '확인', note: '다시 보니 맞음' }, tmpL);
    const row = S().row;
    writeFileSync(tmpM, JSON.stringify({ ...markOf(tmpM), nudgedFor: row.at }));
    ok('한 번 막았으면 또 안 막는다', S().nudged === true);

    const msg = message(row);
    ok('판정은 만드는 쪽에 넘긴다', msg.includes('만드는 쪽') && msg.includes('C1'));
    ok('주장은 재는 쪽에 넘긴다',
       message({ id: 'C9', kind: 'claim', by: 'builder' }).includes('재는 쪽'));

    // 표시 파일이 깨져도 멈추면 안 된다. 못 읽으면 안 넘긴 것으로 본다.
    writeFileSync(tmpM, '{깨짐');
    ok('깨진 표시는 없는 셈', S().pending === true);

    console.log(`\n${n}개 점검 통과\n`);
  } finally {
    for (const f of [tmpL, tmpM]) { try { unlinkSync(f); } catch { /* 이미 없으면 됐다 */ } }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) { console.log('\n자체 점검\n'); selftest(); process.exit(0); }
  process.exit(main(argv));
}
