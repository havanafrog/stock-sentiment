// 댓글을 시간봉에 묶는다. 봉 i 는 [bars[i].ms, +1h) 이고, 그 안의 댓글만 센다.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath } from '../../paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BAR_MS = 3_600_000;

/** server.mjs 와 같은 방식으로 사전·모델을 읽어 채점기를 낸다. */
export function loadScorer() {
  const LEX = {};
  new Function('window', readFileSync(join(ROOT, 'lexicon.js'), 'utf8'))(LEX);
  const mf = join(ROOT, 'model.json');
  const model = existsSync(mf) ? LEX.loadModel(JSON.parse(readFileSync(mf, 'utf8'))) : null;
  return {
    isWail: t => LEX.isWail(t),
    sent: model ? t => LEX.scoreModel(t, model) : t => LEX.scoreWith(t, LEX.LEX_DEFAULT),
  };
}

/** data/<종목>.live.jsonl → [{ms, text}] 시간순 */
export function loadComments(ticker) {
  const f = dataPath(`${ticker}.live.jsonl`);
  if (!existsSync(f)) return [];
  const out = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const c = JSON.parse(line);
      const ms = Date.parse(c.at);
      if (Number.isFinite(ms) && c.text) out.push({ ms, text: c.text });
    } catch { /* 깨진 줄 */ }
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/**
 * 봉마다 {t, n, wail, wailRatio, sent}. 댓글이 없는 봉은 wailRatio/sent 가 null.
 * comments: [{ms, text}] 시간순, bars: 오래된 순. 봉 밖(앞뒤·장 마감 틈)의 댓글은 버린다.
 */
export function replay(comments, bars, scorer) {
  const rows = bars.map(b => ({ t: b.ms, n: 0, wail: 0, wailRatio: null, sent: null, _s: 0 }));
  let j = 0;
  for (const c of comments) {
    while (j < bars.length && c.ms >= bars[j].ms + BAR_MS) j++;
    if (j >= bars.length) break;
    if (c.ms < bars[j].ms) continue;
    const r = rows[j];
    r.n++;
    if (scorer.isWail(c.text)) r.wail++;
    r._s += scorer.sent(c.text);
  }
  for (const r of rows) {
    if (r.n) { r.wailRatio = r.wail / r.n; r.sent = r._s / r.n; }
    delete r._s;
  }
  return rows;
}
