// 볼 종목.
//
// 예전에는 [본주, 레버리지] 짝으로 묶었다. 레버리지 ETF 는 본주를 배로 따라가니
// 두 커뮤니티의 감정 차이를 보려던 것이었는데, 화면이 그 구조를 쓰지 않게 되면서
// 짝은 UI 를 복잡하게 만들기만 했다. 지금은 종목마다 따로 본다.
//
// 목록은 data/tickers.json 에 있으면 그걸 쓰고, 없으면 아래 기본값을 쓴다.
// 화면(사용법 › 종목 관리)에서 고치면 그 파일이 바뀐다.
// 파일이 깨졌거나 없어도 기본값으로 돌아가므로 앱이 멈추지 않는다.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dataPath } from './paths.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TICKERS_FILE = dataPath('tickers.json');

const DEFAULT = ['SNDK', 'SNXX', 'MU', 'MUU', 'KORU'];

/** 티커는 영숫자·점·하이픈만. 파일 이름이 되므로 경로 문자가 섞이면 안 된다. */
export const okSymbol = s => typeof s === 'string' && /^[A-Z0-9.\-]{1,12}$/.test(s);

function sane(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    // 옛 파일은 [본주, 레버리지] 짝이었다. 납작하게 편다.
    const items = Array.isArray(row) ? row : [row];
    for (const it of items) {
      if (!it) continue;
      const s = String(it).toUpperCase();
      if (!okSymbol(s) || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out.length ? out : null;
}

/** 지금 이 순간의 목록. 파일이 바뀌면 다음 호출부터 반영된다. */
export function loadTickers() {
  if (!existsSync(TICKERS_FILE)) return DEFAULT;
  try {
    return sane(JSON.parse(readFileSync(TICKERS_FILE, 'utf8'))) ?? DEFAULT;
  } catch {
    return DEFAULT;                             // 깨진 파일 때문에 멈추지는 않는다
  }
}

export function saveTickers(list) {
  const clean = sane(list);
  if (!clean) throw new Error('종목 목록이 비어 있거나 형식이 잘못됐습니다.');
  mkdirSync(dirname(TICKERS_FILE), { recursive: true });
  writeFileSync(TICKERS_FILE, JSON.stringify(clean, null, 2) + '\n');
  return clean;
}

// 한 번 읽은 값. 스크립트(수집·빌드)는 시작할 때 정해지면 되므로 이걸 쓴다.
// 계속 떠 있는 서버는 loadTickers() 를 그때그때 부른다.
export const TICKERS = loadTickers();
