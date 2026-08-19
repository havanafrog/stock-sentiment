// CSS 토큰 검사.
//
// var(--x) 를 쓰는데 --x 가 정의돼 있지 않으면 그 선언은 통째로 무시된다.
// 오류도 경고도 없다. 실제로 이렇게 당했다: TASTE 토큰을 갈아끼우다 --fear 를
// 흘렸고, 공포지수 선이 stroke: var(--fear) 라 아무 소리 없이 안 그려졌다.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['live.html', 'index.html'];

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

// 브라우저가 기본으로 아는 것들 — 우리가 정의할 필요 없다
const BUILTIN = new Set([]);

for (const f of FILES) {
  console.log(`\n── ${f} ──`);
  const src = readFileSync(join(ROOT, f), 'utf8');

  // 정의: --x: 값;  (CSS 블록 안)
  const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const defined = new Set([...style.matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)].map(m => m[1]));

  // 사용: var(--x) — CSS 와 JS(문자열) 양쪽 다
  const used = new Map();
  for (const m of src.matchAll(/var\((--[a-zA-Z][\w-]*)/g)) {
    used.set(m[1], (used.get(m[1]) ?? 0) + 1);
  }

  const missing = [...used.keys()].filter(k => !defined.has(k) && !BUILTIN.has(k));
  ok(`쓰는 토큰이 전부 정의돼 있다 (${used.size}개 사용 / ${defined.size}개 정의)`,
     missing.length === 0, missing.join(' '));

  // 밝은 테마에 있는 색 토큰은 어두운 테마에도 있어야 한다.
  // 한쪽에만 정의하면 다른 테마에서 그 요소가 사라진다.
  const lightBlock = style.slice(style.indexOf('color-scheme: light;'),
                                 style.indexOf('@media (prefers-color-scheme: dark)'));
  const darkBlock = style.slice(style.indexOf('@media (prefers-color-scheme: dark)'),
                               style.indexOf(':root[data-theme="dark"]'));
  const themeBlock = style.slice(style.indexOf(':root[data-theme="dark"]'));

  const names = b => new Set([...b.matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)].map(m => m[1]));
  const light = names(lightBlock), dark = names(darkBlock), theme = names(themeBlock.slice(0, 1400));

  // 어두운 테마는 밝은 것 위에 덮어쓰므로 전부 다시 낼 필요는 없다.
  // 다만 어두운 쪽에만 있는 이름은 밝은 테마에서 정의가 없다는 뜻이라 위험하다.
  const darkOnly = [...dark].filter(k => !light.has(k));
  ok('어두운 테마에만 있는 토큰이 없다', darkOnly.length === 0, darkOnly.join(' '));

  const themeOnly = [...theme].filter(k => !light.has(k));
  ok('data-theme 블록에만 있는 토큰이 없다', themeOnly.length === 0, themeOnly.join(' '));

  // 두 어두운 블록(미디어 쿼리 / 수동 토글)은 같은 이름을 덮어야 한다.
  const drift = [...dark].filter(k => !theme.has(k)).concat([...theme].filter(k => !dark.has(k)));
  ok('두 어두운 블록이 같은 토큰을 덮는다', drift.length === 0, [...new Set(drift)].join(' '));

  // 괄호·중괄호 균형 — 하나만 어긋나도 그 뒤 규칙이 통째로 죽는다
  const cnt = (re) => (style.match(re) || []).length;
  ok('중괄호 균형', cnt(/{/g) === cnt(/}/g), `${cnt(/{/g)} / ${cnt(/}/g)}`);
  ok('소괄호 균형', cnt(/\(/g) === cnt(/\)/g), `${cnt(/\(/g)} / ${cnt(/\)/g)}`);

  // 같은 이름을 두 번 정의하면 나중 것이 이기고 앞의 뜻이 조용히 사라진다
  const dupLight = [...lightBlock.matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)].map(m => m[1]);
  const seen = new Set(), dup = [];
  for (const k of dupLight) { if (seen.has(k)) dup.push(k); seen.add(k); }
  ok('밝은 테마에 중복 정의가 없다', dup.length === 0, [...new Set(dup)].join(' '));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
