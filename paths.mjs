// 쓰기가 일어나는 자리를 한 곳으로 모은다.
//
// 컨테이너에서 코드는 이미지 안에, 남는 것은 볼륨 하나에 둔다. 흩어져 있으면
// 볼륨을 여러 개 걸거나 파일 하나씩 마운트해야 하는데 둘 다 잘 깨진다.
//
// STOCK_DATA_DIR 을 주면 그 밑으로 간다. 안 주면 예전 그대로 ./data 라
// 이미 돌던 것은 바뀌는 게 없다.
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

export const APP_DIR = dirname(fileURLToPath(import.meta.url));

const raw = process.env.STOCK_DATA_DIR;
export const DATA_DIR = raw
  ? (isAbsolute(raw) ? raw : resolve(APP_DIR, raw))
  : join(APP_DIR, 'data');

/** 글 원본·기준선·종목 목록·접근키가 모두 여기 아래에 있다. */
export const dataPath = (...p) => join(DATA_DIR, ...p);

/**
 * build.mjs 가 내놓는 기준선. 예전에는 앱 폴더에 있었다.
 * 볼륨 쪽에 있으면 먼저 그걸 쓰고, 없으면 이미지에 딸려 온 것을 쓴다 —
 * 처음 띄웠을 때 build 를 돌리기 전에도 화면이 비지 않는다.
 */
export const BASELINE_FILE = dataPath('data.js');
export const BASELINE_FALLBACK = join(APP_DIR, 'data.js');

/**
 * 사람이 손으로 찍은 정답. 한 줄에 하나, 나중 줄이 이긴다 —
 * 고쳐 찍으면 앞의 줄을 지울 필요 없이 덮인다.
 */
export const LABELS_FILE = dataPath('labels.jsonl');

export function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}
