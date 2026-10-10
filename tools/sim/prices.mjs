// 가격 봉 — 한 번 받으면 tools/sim/cache/ 에 두고 다시 받지 않는다.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStock, fetchBars } from '../../toss.mjs';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), 'cache');

export async function loadBars(ticker) {
  const f = join(CACHE, `${ticker}.min60.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const { code } = await resolveStock(ticker);
  const bars = await fetchBars(code, 'min:60', 450);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(f, JSON.stringify(bars));
  return bars;
}
