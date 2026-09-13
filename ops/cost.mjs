// 이 창이 토큰을 얼마나 썼나.
//
//   node ops/cost.mjs <기록.jsonl>
//   node ops/cost.mjs --selftest
//
// 기록에 토큰 수는 있는데 금액은 없다. 단가를 곱해서 낸다.
//
// 합계를 내려면 파일을 통째로 읽어야 한다. 제일 큰 기록이 45MB 인데 판은 2초마다
// 돌아서 매번 다 읽으면 못 쓴다. 기록은 뒤에만 붙는(append-only) 파일이라
// **이어 읽기**로 푼다 — 파일마다 어디까지 셌는지를 기억해 두고 그 뒤만 읽어
// 더한다. 첫 한 번만 비싸다.
//
// ponytail: 첫 읽기는 파일 크기만큼 버퍼를 한 번에 잡는다. 45MB 는 괜찮다.
// 기록이 몇 백 MB 로 자라면 그때 조각내서 읽는다.
import { statSync, openSync, readSync, closeSync } from 'node:fs';
import { writeFileSync, appendFileSync, unlinkSync } from 'node:fs';   // 점검에서만 쓴다
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// 1M 토큰당 달러. 캐시 값은 입력 단가에 배수를 곱해서 낸다.
export const PRICES = {
  'claude-opus-5': { in: 5, out: 25, fast: { in: 10, out: 50 } },
  'claude-opus-4-8': { in: 5, out: 25, fast: { in: 10, out: 50 } },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-mythos-5': { in: 10, out: 50 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

// 캐시 배수. 읽기는 입력의 10분의 1, 쓰기는 5분짜리가 1.25배 1시간짜리가 2배다.
export const CACHE_READ = 0.1;
export const WRITE_5M = 1.25;
export const WRITE_1H = 2;

const M = 1_000_000;

/** 한 줄이 쓴 돈. 모르는 모델이면 0 — 없는 단가를 지어내지 않는다. */
export function rowCost(u, model) {
  const p = PRICES[model];
  if (!p) return 0;
  const rate = u.speed === 'fast' && p.fast ? p.fast : p;
  // cache_creation 이 없는 오래된 줄은 전부 5분짜리로 친다.
  const c = u.cache_creation ?? {};
  const w1h = c.ephemeral_1h_input_tokens ?? 0;
  const w5m = c.ephemeral_5m_input_tokens
    ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h);
  return (
    (u.input_tokens ?? 0) * rate.in
    + (u.output_tokens ?? 0) * rate.out
    + (u.cache_read_input_tokens ?? 0) * rate.in * CACHE_READ
    + w5m * rate.in * WRITE_5M
    + w1h * rate.in * WRITE_1H
  ) / M;
}

const zero = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0, usd: 0, rows: 0 });

/** 이 줄들을 합계에 더한다. 파일을 안 만지므로 점검이 쉽다. */
export function add(sum, lines) {
  for (const l of lines) {
    if (!l) continue;
    let j = null;
    try { j = JSON.parse(l); } catch { continue; }
    const u = j?.message?.usage;
    if (!u) continue;
    const c = u.cache_creation ?? {};
    sum.in += u.input_tokens ?? 0;
    sum.out += u.output_tokens ?? 0;
    sum.cacheRead += u.cache_read_input_tokens ?? 0;
    sum.cacheWrite += (c.ephemeral_1h_input_tokens ?? 0)
      + (c.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0);
    sum.usd += rowCost(u, j?.message?.model);
    sum.rows++;
  }
  return sum;
}

// 파일마다 어디까지 셌나. 판이 계속 떠 있으므로 메모리에 둔다.
const SEEN = new Map();

/**
 * 기록 하나의 합계. 지난번 이후 늘어난 부분만 읽는다.
 *
 * 파일이 줄었으면 갈아엎힌 것이므로 처음부터 다시 센다.
 */
export function tally(file, seen = SEEN) {
  let size = 0;
  try { size = statSync(file).size; } catch { return zero(); }

  let mark = seen.get(file);
  if (!mark || mark.at > size) mark = { at: 0, sum: zero() };

  if (size > mark.at) {
    const span = size - mark.at;
    const buf = Buffer.alloc(span);
    const h = openSync(file, 'r');
    try { readSync(h, buf, 0, span, mark.at); } finally { closeSync(h); }
    // 마지막 줄바꿈까지만 센다. 그 뒤는 아직 쓰는 중인 반쪽 줄이다.
    // 줄바꿈에서 자르면 조각이 항상 온전한 UTF-8 이라 글자가 안 깨진다.
    const cut = buf.lastIndexOf(0x0a);
    if (cut >= 0) {
      add(mark.sum, buf.subarray(0, cut).toString('utf8').split('\n'));
      mark.at += cut + 1;
    }
  }
  seen.set(file, mark);
  return { ...mark.sum };
}

export function selftest() {
  let n = 0;
  const ok = (what, cond, extra = '') => {
    n++;
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? '  ' + extra : ''}`);
    if (!cond) process.exitCode = 1;
  };

  // 단가. 입력 1M 이면 딱 5달러여야 한다.
  ok('입력 단가', rowCost({ input_tokens: M }, 'claude-opus-5') === 5);
  ok('출력 단가', rowCost({ output_tokens: M }, 'claude-opus-5') === 25);
  ok('캐시 읽기는 10분의 1',
     rowCost({ cache_read_input_tokens: M }, 'claude-opus-5') === 0.5);
  ok('캐시 쓰기 5분은 1.25배', rowCost({
     cache_creation: { ephemeral_5m_input_tokens: M } }, 'claude-opus-5') === 6.25);
  ok('캐시 쓰기 1시간은 2배', rowCost({
     cache_creation: { ephemeral_1h_input_tokens: M } }, 'claude-opus-5') === 10);
  ok('빠른 모드는 두 배', rowCost({ input_tokens: M, speed: 'fast' }, 'claude-opus-5') === 10);
  ok('모르는 모델은 0원', rowCost({ input_tokens: M }, '<synthetic>') === 0
     && rowCost({ input_tokens: M }, undefined) === 0);
  // cache_creation 이 없는 옛 줄도 세야 한다.
  ok('옛 줄은 5분짜리로', rowCost({ cache_creation_input_tokens: M }, 'claude-opus-5') === 6.25);

  const line = (o) => JSON.stringify({ message: { model: 'claude-opus-5', usage: o } });
  const rows = Array.from({ length: 40 }, (_, i) => line({
    input_tokens: i, output_tokens: 100,
    cache_read_input_tokens: 1000,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 },
  }));

  // 이어 읽기가 통째로 읽은 것과 같아야 한다. 이게 제일 중요하다.
  const f = join(tmpdir(), `ops-cost-${process.pid}.jsonl`);
  writeFileSync(f, rows.slice(0, 25).join('\n') + '\n');

  const step = new Map();
  const a = tally(f, step);                    // 앞 25줄
  appendFileSync(f, rows.slice(25).join('\n') + '\n');
  const b = tally(f, step);                    // 뒤 15줄만 더 읽는다
  const whole = tally(f, new Map());           // 통째로
  ok('앞부분을 센다', a.rows === 25, String(a.rows));
  ok('이어 읽기가 통째로와 같다',
     b.rows === whole.rows && Math.abs(b.usd - whole.usd) < 1e-12
     && b.in === whole.in && b.cacheWrite === whole.cacheWrite,
     `${b.rows}/${whole.rows} ${b.usd}/${whole.usd}`);
  ok('두 번 세지 않는다', b.rows === 40, String(b.rows));

  // 반쪽 줄은 다음번에 센다. 지금 세면 JSON 이 깨진다.
  appendFileSync(f, '{"message":{"model":"claude-opus-5","usage":{"input_tok');
  const half = tally(f, step);
  ok('쓰는 중인 줄은 안 센다', half.rows === 40, String(half.rows));
  appendFileSync(f, 'ens":1000000}}}\n');
  ok('다 쓰이면 그때 센다', tally(f, step).rows === 41);

  // 파일이 갈아엎히면 처음부터 다시 센다.
  writeFileSync(f, rows[0] + '\n');
  const fresh = tally(f, step);
  ok('파일이 줄면 다시 센다', fresh.rows === 1, String(fresh.rows));

  unlinkSync(f);
  console.log(`\n${n}개 점검 통과\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--selftest')) { console.log('\n자체 점검\n'); selftest(); }
  else {
    const f = process.argv[2];
    if (!f) { console.error('기록 파일을 주세요'); process.exit(1); }
    const t = tally(f);
    console.log(JSON.stringify({ ...t, usd: +t.usd.toFixed(4) }, null, 2));
  }
}
