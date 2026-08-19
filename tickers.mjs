// 볼 종목과 짝.
//
// 짝은 [본주, 레버리지] 순서다. 레버리지가 없으면 null.
// 레버리지 ETF 는 본주를 배로 따라가므로 주가끼리 상관은 거의 1 로 자명하다.
// 볼 만한 건 감정 쪽 차이 — 어느 커뮤니티가 먼저·세게 반응하는가.
//
// 목록은 data/tickers.json 에 있으면 그걸 쓰고, 없으면 아래 기본값을 쓴다.
// 화면(사용법 › 종목 관리)에서 고치면 그 파일이 바뀐다.
// 파일이 깨졌거나 없어도 기본값으로 돌아가므로 앱이 멈추지 않는다.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TICKERS_FILE = join(HERE, 'data', 'tickers.json');

const DEFAULT_PAIRS = [
  ['SNDK', 'SNXX'],
  ['MU', 'MUU'],
  ['KORU', null],
];

/** 티커는 영숫자·점·하이픈만. 파일 이름이 되므로 경로 문자가 섞이면 안 된다. */
export const okSymbol = s => typeof s === 'string' && /^[A-Z0-9.\-]{1,12}$/.test(s);

function sane(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    if (!Array.isArray(row) || !row.length) continue;
    const base = String(row[0] ?? '').toUpperCase();
    const lev = row[1] ? String(row[1]).toUpperCase() : null;
    if (!okSymbol(base) || seen.has(base)) continue;
    if (lev && (!okSymbol(lev) || seen.has(lev))) continue;
    seen.add(base);
    if (lev) seen.add(lev);
    out.push([base, lev]);
  }
  return out.length ? out : null;
}

/** 지금 이 순간의 목록. 파일이 바뀌면 다음 호출부터 반영된다. */
export function loadPairs() {
  if (!existsSync(TICKERS_FILE)) return DEFAULT_PAIRS;
  try {
    return sane(JSON.parse(readFileSync(TICKERS_FILE, 'utf8'))) ?? DEFAULT_PAIRS;
  } catch {
    return DEFAULT_PAIRS;                       // 깨진 파일 때문에 멈추지는 않는다
  }
}

export function savePairs(pairs) {
  const clean = sane(pairs);
  if (!clean) throw new Error('종목 목록이 비어 있거나 형식이 잘못됐습니다.');
  mkdirSync(dirname(TICKERS_FILE), { recursive: true });
  writeFileSync(TICKERS_FILE, JSON.stringify(clean, null, 2) + '\n');
  return clean;
}

export const flatten = pairs => pairs.flat().filter(Boolean);
export const levSet = pairs => new Set(pairs.map(([, lev]) => lev).filter(Boolean));

// 한 번 읽은 값. 스크립트(수집·빌드)는 시작할 때 정해지면 되므로 이걸 쓴다.
// 계속 떠 있는 서버는 loadPairs() 를 그때그때 부른다.
export const PAIRS = loadPairs();
export const TICKERS = flatten(PAIRS);
export const LEVERAGED = levSet(PAIRS);
