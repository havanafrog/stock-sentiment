// 답을 다음 물음으로 먹이는 고리.
//
//   node tools/self-loop.mjs "첫 물음" [간격초] [최대판수]
//   node tools/self-loop.mjs --file tools/auto-ui-prompt.txt 900
//
// 한 판 돌면 그 판의 답이 다음 판의 물음이 된다. 대화는 -c 로 이어지니
// 앞판을 다시 설명할 필요가 없고, 답 자체가 "다음에 뭘 할까"가 된다.
//
// 배치로 안 쓴 이유: cmd 는 따옴표와 글자표에서 세 번 깨졌고, OneDrive 폴더에서는
// .bat 에 실행 비트가 안 붙어 git bash 가 아예 못 부른다. node 는 둘 다 없다.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

// --dir 은 일할 폴더, --file 은 첫 물음이 든 파일. 둘 다 값을 하나씩 먹는다.
// 그 둘을 걷어 내고 남는 것이 간격초와 판수다.
const take = name => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const dir = take('--dir');
const file = take('--file');
if (dir) process.chdir(dir);

// --dir 로 옮긴 뒤에 읽으면 상대 경로가 엇갈린다. 파일은 부른 자리 기준으로 읽는다.
let prompt = file ? readFileSync(join(HERE, '..', file.replace(/^\.\//, '')), 'utf8').trim() : argv[0];
const rest = file ? argv : argv.slice(1);
const everySec = Number(rest[0]) || 900;
const maxRounds = Number(rest[1]) || 0;          // 0 = 끝없이

if (!prompt) {
  console.error('첫 물음이 없습니다.  node tools/self-loop.mjs "무엇을 할지" [간격초] [최대판수]');
  process.exit(1);
}

// 답이 길면 그대로 되먹이지 않는다. 물음이 매 판 부풀면 돈만 쓰고 초점이 흐려진다.
const CAP = 4000;
// 사람 없는 자리에서 파일을 고치게 한다. push 는 열지 않는다.
const FLAGS = (process.env.SELF_LOOP_FLAGS ??
  '--permission-mode acceptEdits --allowedTools Read Edit Write Glob Grep Bash(node:*) Bash(git:*) Bash(curl:*)')
  .split(' ').filter(Boolean);

const LOG = join(HERE, 'self-loop.log');
const JSONL = join(HERE, 'self-loop.jsonl');
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

console.log(`고리 시작 — ${everySec}초 간격${maxRounds ? `, ${maxRounds}판` : ''}. 기록: ${LOG}`);

let prev = null;                              // 앞판 답. 같은 말을 되풀이하면 멈춘다
for (let round = 1; !maxRounds || round <= maxRounds; round++) {
  const args = ['-p', ...(round > 1 ? ['-c'] : []), prompt, '--output-format', 'json', ...FLAGS];
  const t0 = Date.now();
  // SELF_LOOP_FAKE 를 주면 claude 를 안 부르고 답을 지어낸다. 되먹임과 멈춤이
  // 제대로 도는지만 확인하는 자리다.
  //   1      판마다 다른 답 — 답이 다음 물음이 되는지
  //   stuck  2판부터 "사람 필요" — 거기서 멈추는지
  //   same   늘 같은 답 — 2판에서 멈추는지
  const FAKE = process.env.SELF_LOOP_FAKE;
  const fakeSay = FAKE === 'stuck' ? (round >= 2 ? '**사람 필요:** 정해 주세요' : '1판 고쳤다')
    : FAKE === 'same' ? '같은 말'
    : `${round}판 답 · 받은 물음: ${prompt.slice(0, 30)}`;
  const r = FAKE
    ? { stdout: JSON.stringify({ result: fakeSay, total_cost_usd: 0.01, num_turns: 1, session_id: 'fake' }), stderr: '', status: 0 }
    : spawnSync('claude', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false });

  let out = (r.stdout || '').trim();
  let answer = out, cost = null, turns = null, sid = null;
  try {
    const j = JSON.parse(out);
    answer = (j.result ?? '').trim();
    cost = j.total_cost_usd ?? null; turns = j.num_turns ?? null; sid = j.session_id ?? null;
  } catch {
    // json 이 아니면 (보통 오류) 원문을 그대로 남긴다. 그래야 왜 죽었는지 보인다.
  }
  const err = (r.stderr || '').trim();

  appendFileSync(LOG,
    `\n===== ${stamp()}  ${round}판 =====\n[물음] ${prompt.slice(0, 500)}\n[답] ${answer || err || '(빈 답)'}\n`);
  appendFileSync(JSONL, JSON.stringify({
    at: new Date().toISOString(), round, sid, cost, turns,
    ms: Date.now() - t0, ask: prompt.slice(0, 500), say: answer.slice(0, 2000),
    status: r.status, err: err.slice(0, 500) || undefined,
  }) + '\n');

  console.log(`${round}판 ${Math.round((Date.now() - t0) / 1000)}초` +
    (cost != null ? ` · $${cost.toFixed(3)}` : '') + (turns != null ? ` · ${turns}턴` : '') +
    ` · ${(answer || err).slice(0, 70).replace(/\s+/g, ' ')}`);

  if (!answer) { console.log('빈 답이라 멈춘다.'); break; }
  if (/^없음\.?$/m.test(answer)) { console.log('더 할 일이 없다고 해서 멈춘다.'); break; }

  // 사람에게 물어야 하는 판이면 멈춘다. 안 멈추면 제 물음을 다음 판에 또 먹어,
  // 답이 올 때까지 같은 말을 되풀이하며 돈만 쓴다 — 실제로 181판 중 162판을
  // 그렇게 헛돌아 $154 중 $120 을 버렸다.
  if (/^\**\s*사람 필요/m.test(answer.slice(0, 200))) {
    console.log('사람 답이 필요하다고 해서 멈춘다. 답을 대기열 파일에 적고 다시 켜라.');
    break;
  }
  // 다른 식으로 갇혀도 멈춘다. 앞판과 거의 같은 말이면 진전이 없는 것이다.
  const head = s => s.replace(/\s+/g, ' ').slice(0, 300);
  if (prev && head(prev) === head(answer)) {
    console.log('앞판과 같은 답이라 멈춘다 — 진전이 없다.');
    break;
  }
  prev = answer;

  // 이 답이 다음 판의 물음이 된다.
  prompt = answer.length > CAP ? answer.slice(0, CAP) + '\n…(줄임)' : answer;

  if (maxRounds && round === maxRounds) break;
  await new Promise(res => setTimeout(res, everySec * 1000));
}
console.log('고리 끝.');
