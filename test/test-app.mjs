// index.html 의 앱 스크립트를 미니 DOM 위에서 실제로 돌린다.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 폴더 이름이 바뀌어도 따라오도록 이 파일 기준으로 잡는다
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
const LEX_SRC = readFileSync(join(ROOT, 'lexicon.js'), 'utf8');

// 마지막 <script> 블록(앱 코드)만 뽑는다
const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const CODE = blocks[blocks.length - 1][1];

// ── 미니 DOM ───────────────────────────────────────────────
function makeNode(id = '') {
  let _html = '';
  const n = {
    id, tagName: 'DIV', children: [], _attrs: {}, style: {}, dataset: {},
    textContent: '', value: '', checked: false,
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    setAttribute(k, v) { this._attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    addEventListener() {},
    closest() { return null; },
    matches() { return false; },
    getBoundingClientRect() { return { left: 0, width: 900 }; },
    querySelector() { return makeNode(); },
    get offsetWidth() { return 178; },
    get offsetHeight() { return 90; },
    // innerHTML 을 비우면 실제 브라우저처럼 자식도 사라져야 한다.
    // (안 그러면 재렌더마다 children 이 쌓여서 카운트 검사가 거짓 통과한다)
    get innerHTML() { return _html; },
    set innerHTML(v) { _html = String(v); this.children.length = 0; },
  };
  return n;
}
const REG = new Map();
const node = id => { if (!REG.has(id)) REG.set(id, makeNode(id)); return REG.get(id); };

global.document = {
  getElementById: id => node(id),
  querySelector: sel => node('sel:' + sel),
  createElement: () => makeNode(),
  createElementNS: () => makeNode(),
  body: makeNode('body'),
};
global.innerWidth = 1200;
global.addEventListener = () => {};      // 탭이 hashchange 를 듣는다
global.location = { hash: '' };
global.confirm = () => true;
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.Blob = class { constructor(p) { this.parts = p; } };

const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: k => store.delete(k),
};

// ── 실행 ──────────────────────────────────────────────────
/**
 * @param stockData  window.STOCK_DATA 로 넣을 값 (null 이면 data.js 없는 경우)
 * @param tweak      첫 렌더 뒤 상태를 바꾸고 다시 그리고 싶을 때
 */
export function run(stockData, tweak) {
  REG.clear(); store.clear();
  // 앱은 lexicon.js 가 window 에 붙여준 사전·채점기를 쓴다. 브라우저의 <script src> 를 흉내낸다.
  global.window = { STOCK_DATA: stockData };
  new Function('window', LEX_SRC)(global.window);

  // render() 가 ROWS/DATES 를 재할당하므로 값이 아니라 게터로 노출해야 한다.
  const wrapped = CODE + `
;globalThis.__X = {
  get ROWS(){return ROWS}, get DATES(){return DATES}, get RATE(){return RATE}, UI,
  render, buildRows, pairTickers,
  money, axisMoney, cur, ALERT };`;
  (0, eval)(wrapped);
  const X = globalThis.__X;
  if (tweak) { tweak(X); X.render(); }
  return { X, node, txt: id => node(id).textContent || node(id).innerHTML };
}

// ── 어서션 ────────────────────────────────────────────────
let pass = 0, fail = 0;
export function ok(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
}
export function summary() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
