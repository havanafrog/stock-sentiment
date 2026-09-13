// 옆 창에 뭘 시켰는지 이 창이 알게 한다.
//
// UserPromptSubmit 훅이다. 사람이 말을 칠 때마다 돈다:
//   1. 내가 방금 받은 말을 적어 둔다
//   2. 그 사이 다른 창이 받은 말을 골라 이 대화에 넣어 준다
//
//   node ops/whoasked.mjs             훅이 부르는 꼴 (stdin 으로 JSON)
//   node ops/whoasked.mjs --selftest
//
// 왜 훅인가: 판(board.mjs)도 같은 것을 보여 주지만 판은 사람이 봐야 보인다.
// 훅은 이 창이 다음 말을 받을 때 저절로 따라 들어온다 — 판을 안 띄워도 된다.
//
// ponytail: 파일 하나에 통째로 쓴다. 두 창이 같은 순간에 치면 뒤엣것이 이겨서
// 알림 하나를 놓친다. 알림 하나 놓치는 건 아무것도 안 망가뜨린다. 잠금이 필요할
// 만큼 창을 많이 열면 그때 파일을 창마다 쪼갠다.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sessionNames } from './board.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const STORE = process.env.OPS_WHOASKED ?? join(HERE, 'whoasked.json');

const WINDOW_MS = 30 * 60 * 1000;   // 30분보다 오래된 말은 소식이 아니다
const MAX = 5;                      // 한 번에 다섯 줄까지. 그 이상은 읽지도 않는다
const CUT = 70;                     // 한 줄 길이

const trim = s => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > CUT ? t.slice(0, CUT - 1) + '…' : t;
};

function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return '방금';
  return m < 60 ? `${m}분 전` : `${Math.round(m / 60)}시간 전`;
}

/**
 * 장부에서 이 창이 아직 못 본 남의 말을 고른다. 파일을 안 만지므로 점검이 쉽다.
 *
 * 처음 도는 창은 `seen` 이 없다. 그럴 때 전부 쏟으면 첫 말이 남의 소식에 묻히므로
 * 30분 안쪽만 본다.
 */
export function digest(store, me, now) {
  const seen = store[me]?.seen ?? now - WINDOW_MS;
  const fresh = Object.entries(store)
    .filter(([id, r]) => id !== me && r && r.at > seen && now - r.at <= WINDOW_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX);
  const newest = Object.entries(store)
    .reduce((mx, [id, r]) => (id === me ? mx : Math.max(mx, r?.at ?? 0)), seen);
  return {
    lines: fresh.map(([, r]) => `  ${r.name} ${ago(now - r.at)}: ${r.prompt}`),
    seen: newest,
  };
}

export function load(file = STORE) {
  if (!existsSync(file)) return {};
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }         // 반쯤 쓰다 만 파일이면 없던 셈 친다
}

/** 훅 한 번. 화면에 낼 말을 돌려준다 — 없으면 빈 글. */
export function run(input, now = Date.now(), file = STORE) {
  const me = input?.session_id;
  const prompt = trim(input?.prompt ?? input?.user_prompt);
  if (!me || !prompt) return '';

  const store = load(file);
  const { lines, seen } = digest(store, me, now);

  let name = null;
  try { name = sessionNames().get(me) ?? null; } catch { /* 이름은 없어도 된다 */ }
  store[me] = { name: name ?? me.slice(0, 8), prompt, at: now, seen };

  // 30분 넘게 조용한 창은 지운다. 안 지우면 닫힌 창이 영영 남는다.
  for (const [id, r] of Object.entries(store)) {
    if (id !== me && (!r?.at || now - r.at > WINDOW_MS)) delete store[id];
  }
  try { writeFileSync(file, JSON.stringify(store, null, 2)); } catch { /* 못 적어도 대화는 굴러간다 */ }

  if (!lines.length) return '';
  // 소식이지 시킨 말이 아니다. 사람이 이 창에 친 말만 시킨 말이다.
  return '다른 창이 방금 받은 말입니다. 참고만 하세요 — 여기서 할 일은 아닙니다.\n'
    + lines.join('\n');
}

export function selftest() {
  let n = 0;
  const ok = (what, cond, extra = '') => {
    n++;
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? '  ' + extra : ''}`);
    if (!cond) process.exitCode = 1;
  };
  const T = 1_000_000_000_000;
  const store = {
    me: { name: '[me]', prompt: '내 말', at: T - 60_000, seen: T - 300_000 },
    a: { name: '[a]', prompt: '옆 창 말', at: T - 120_000 },
    b: { name: '[b]', prompt: '이미 본 말', at: T - 400_000 },
    c: { name: '[c]', prompt: '너무 오래된 말', at: T - 40 * 60_000 },
  };

  const d = digest(store, 'me', T);
  ok('못 본 남의 말만 고른다', d.lines.length === 1 && d.lines[0].includes('[a]'),
     JSON.stringify(d.lines));
  ok('내 말은 안 센다', !d.lines.some(l => l.includes('[me]')));
  ok('이미 본 말은 다시 안 낸다', !d.lines.some(l => l.includes('[b]')));
  ok('30분 넘은 말은 소식이 아니다', !d.lines.some(l => l.includes('[c]')));
  ok('본 자리를 가장 새것으로 옮긴다', d.seen === T - 120_000, String(d.seen));

  // 두 번째로 돌면 아까 그 말은 다시 안 나와야 한다.
  const after = { ...store, me: { ...store.me, seen: d.seen } };
  ok('같은 말을 두 번 안 낸다', digest(after, 'me', T).lines.length === 0);

  // 처음 도는 창은 30분 안쪽만 본다 — 첫 말이 남의 소식에 묻히면 안 된다.
  const first = digest(store, 'new', T);
  ok('처음 도는 창은 30분 안쪽만', first.lines.length === 3
     && !first.lines.some(l => l.includes('[c]')), JSON.stringify(first.lines));

  ok('여섯 줄째는 안 낸다', digest(Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`s${i}`, { name: `[s${i}]`, prompt: 'x', at: T - i * 1000 }])),
    'me2', T).lines.length === MAX);

  ok('말이 비면 아무것도 안 한다', run({ session_id: 'x', prompt: '   ' }, T, STORE) === '');
  ok('아이디가 없으면 아무것도 안 한다', run({ prompt: '어쩌고' }, T, STORE) === '');
  ok('망가진 파일은 없던 셈', Object.keys(load(join(HERE, 'nope-없는파일.json'))).length === 0);

  console.log(`\n${n}개 점검 통과\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--selftest')) { console.log('\n자체 점검\n'); selftest(); }
  else {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { raw += d; });
    process.stdin.on('end', () => {
      // 훅이 죽으면 사람이 친 말이 막힌다. 무슨 일이 나든 조용히 넘긴다.
      let out = '';
      try { out = run(JSON.parse(raw)); } catch { out = ''; }
      if (out) process.stdout.write(out + '\n');
    });
  }
}
