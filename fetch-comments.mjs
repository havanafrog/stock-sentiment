/**
 * 토스증권 종목 커뮤니티 게시글을 받아 data/{티커}.posts.json 으로 떨군다.
 * 채점과 집계는 build.mjs 가 한다. 여기는 원문만 모은다.
 *
 *   node fetch-comments.mjs                      # tickers.mjs 의 5종목, 최근 30일
 *   node fetch-comments.mjs SNDK SNXX --days 60  # 종목·기간 직접 지정
 *
 * 두 번째 실행부터는 증분이다. 이미 받은 게시글을 만나면 거기서 멈춘다.
 * 첫 백필은 오래 걸린다 — 페이지당 11건 서버 고정이라 게시글 많은 종목은 하루 약 260페이지.
 *
 * 요구: Node 18+ (내장 fetch). 외부 패키지 없음. 인증 없음.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStock, fetchComments, et } from './toss.mjs';
import { TICKERS } from './tickers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data');

const argv = process.argv.slice(2);
const dashDays = argv.indexOf('--days');
const DAYS = Number(dashDays >= 0 ? argv[dashDays + 1] : 30);
const want = argv.filter((a, i) => !a.startsWith('--') && i !== dashDays + 1).map(t => t.toUpperCase());
const LIST = want.length ? want : TICKERS;

if (!Number.isFinite(DAYS) || DAYS < 1) {
  console.error('\n--days 는 1 이상의 숫자여야 합니다.\n');
  process.exit(1);
}

const postsPath = t => join(DATA, `${t}.posts.json`);

function readPosts(ticker) {
  const p = postsPath(ticker);
  if (!existsSync(p)) return [];
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch (e) {
    console.warn(`  ${ticker}.posts.json 을 읽지 못했습니다: ${e.message} — 처음부터 받습니다`);
    return [];
  }
}

// 미 동부 기준 오늘에서 DAYS 일 전. 게시글 날짜와 같은 기준이라야 경계가 안 어긋난다.
function cutoffDate() {
  const today = et(new Date().toISOString()).date;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - DAYS);
  return d.toISOString().slice(0, 10);
}

mkdirSync(DATA, { recursive: true });

const cutoff = cutoffDate();
console.log(`\n커뮤니티 수집 · ${LIST.join(' ')} · ${cutoff} 이후 (미 동부 기준 ${DAYS}일)\n`);

let failed = 0;
for (const ticker of LIST) {
  try {
    const { code, name } = await resolveStock(ticker);
    const existing = readPosts(ticker);
    const seen = new Set(existing.map(p => p.id));

    // 기존 데이터가 이미 cutoff 까지 닿아 있을 때만 "중복 만나면 중단"이 안전하다.
    // 3일치만 있는데 30일을 요청하면 첫 중복에서 멈춰 영영 안 늘어난다.
    const oldest = existing.length ? et(existing[0].at).date : null;
    const covered = oldest !== null && oldest <= cutoff;

    process.stdout.write(`${ticker.padEnd(6)} ${name}`);
    if (seen.size) process.stdout.write(`  (기존 ${seen.size}건, ${oldest}~`
      + `${covered ? ' · 증분' : ` · ${cutoff} 까지 더 받습니다`})`);
    process.stdout.write('\n');

    const t0 = Date.now();
    const { posts: fresh, pages, stop } = await fetchComments(code, cutoff, seen, {
      stopOnSeen: covered,
      onProgress: (pg, n) => {
        if (pg % 25 === 0) process.stdout.write(`\r  ${pg}페이지 · ${n}건…`);
      },
    });
    if (pages >= 25) process.stdout.write('\r'.padEnd(40) + '\r');

    // 병합 후 기간 밖은 버린다. 같은 id 는 새 것으로 덮는다.
    const merged = new Map(existing.map(p => [p.id, p]));
    for (const p of fresh) merged.set(p.id, p);
    const kept = [...merged.values()]
      .filter(p => et(p.at).date >= cutoff)
      .sort((a, b) => (a.at < b.at ? -1 : 1));

    writeFileSync(postsPath(ticker), JSON.stringify(kept));
    console.log(`  ${pages}페이지 / 새 ${fresh.length}건 / 보관 ${kept.length}건 `
      + `(${((Date.now() - t0) / 1000).toFixed(1)}초) — ${stop}`);
  } catch (e) {
    failed++;
    console.error(`  ${ticker} 실패: ${e.message}`);
  }
  console.log('');
}

console.log(failed
  ? `${LIST.length - failed}/${LIST.length} 종목 완료 (${failed}개 실패)\n\n다음: node build.mjs\n`
  : `${LIST.length}개 종목 완료\n\n다음: node build.mjs\n`);
if (failed === LIST.length) process.exit(1);
