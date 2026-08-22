// 홀드아웃 채점. 튜닝에 쓴 3,991건은 빼고 잰다 — 같은 글로 재면 사전이 잘하는 게 아니라
// 그 글을 외운 것이다.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const W = {};
new Function('window', readFileSync('lexicon.js', 'utf8'))(W);

const tuned = new Set(JSON.parse(readFileSync('docs/labels-4000.json', 'utf8')).map(r => r.id));
const all = JSON.parse(readFileSync('docs/labels-holdout-12000.json', 'utf8'));
const held = all.filter(r => !tuned.has(r.id));

// 화면에서 손으로 찍은 것. 한 줄에 하나, 나중 줄이 이긴다.
// 없으면 그냥 건너뛴다 — 아직 아무도 안 찍었을 뿐이다.
function readMine() {
  const f = process.env.STOCK_DATA_DIR
    ? join(process.env.STOCK_DATA_DIR, 'labels.jsonl') : 'data/labels.jsonl';
  if (!existsSync(f)) return [];
  const by = new Map();
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (r.y && r.text) by.set(r.id, r); else by.delete(r.id);
    } catch { /* 잘린 줄 */ }
  }
  return [...by.values()];
}
const mine = readMine();

console.log(`전체 ${all.length.toLocaleString()} · 튜닝 겹침 ${(all.length - held.length).toLocaleString()} · 홀드아웃 ${held.length.toLocaleString()}\n`);

const pred = t => { const s = W.scoreWith(t, W.LEX_DEFAULT); return s > 0 ? 'P' : s < 0 ? 'N' : 'X'; };

function score(rows, tag) {
  const cm = {};
  for (const r of rows) { const k = r.y + '/' + pred(r.text); cm[k] = (cm[k] || 0) + 1; }
  const n = (a, b) => cm[a + '/' + b] || 0;
  console.log(`── ${tag} (${rows.length.toLocaleString()}건) ──`);
  console.log('        예측 P   예측 N   예측 X');
  for (const y of ['P', 'N', 'X'])
    console.log(`실제 ${y}  ${String(n(y,'P')).padStart(6)}  ${String(n(y,'N')).padStart(6)}  ${String(n(y,'X')).padStart(6)}`);

  const f1 = c => {
    const tp = n(c, c);
    const fp = ['P','N','X'].filter(y => y !== c).reduce((s, y) => s + n(y, c), 0);
    const fn = ['P','N','X'].filter(p => p !== c).reduce((s, p) => s + n(c, p), 0);
    const pr = tp / (tp + fp || 1), rc = tp / (tp + fn || 1);
    return { pr, rc, f1: 2 * pr * rc / (pr + rc || 1) };
  };
  for (const c of ['P', 'N']) {
    const m = f1(c);
    console.log(`  ${c}  정밀도 ${(m.pr*100).toFixed(1)}%  재현율 ${(m.rc*100).toFixed(1)}%  F1 ${(m.f1*100).toFixed(1)}%`);
  }
  const acc = ['P','N','X'].reduce((s, c) => s + n(c, c), 0) / rows.length;
  console.log(`  전체 정확도 ${(acc*100).toFixed(1)}%\n`);
}

score(held, '홀드아웃');
score(all.filter(r => tuned.has(r.id)), '튜닝에 쓴 글');

// 손으로 찍은 것은 사전을 고친 뒤 바로 다시 재려고 따로 낸다.
// 화면에서 어긋난 글만 골라 찍으므로 여기 숫자는 홀드아웃보다 낮게 나오는 게 정상이다.
if (mine.length) score(mine, '직접 찍은 것');
else console.log('직접 찍은 것 없음 — 글 탭에서 라벨을 켜고 찍으면 여기에 같이 나옵니다.\n');

