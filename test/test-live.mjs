// live.html 의 앱 스크립트를 미니 DOM 위에서 실제로 돌린다.
// index.html 쪽(test-app.mjs)과 같은 방식이지만, 이 페이지는 SSE·fetch·해시 라우팅을
// 쓰기 때문에 스텁이 몇 개 더 필요하다.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'live.html'), 'utf8');

const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const CODE = blocks[blocks.length - 1][1];

// ── 미니 DOM ───────────────────────────────────────────────
function makeNode(id = '') {
  let _html = '';
  const n = {
    id, tagName: 'DIV', children: [], _attrs: {}, style: {}, dataset: {},
    textContent: '', value: '',
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    removeAttribute(k) { delete this._attrs[k]; },
    hasAttribute(k) { return k in this._attrs; },
    toggleAttribute(k, on) { if (on) this._attrs[k] = ''; else delete this._attrs[k]; return !!on; },
    // CSS 가 보는 건 속성이다. hidden 을 속성 위에 얹어 둔다 —
    // 자바스크립트 속성만 바뀌고 문서가 그대로인 실수를 테스트가 잡아야 한다.
    get hidden() { return 'hidden' in this._attrs; },
    set hidden(v) { this.toggleAttribute('hidden', v); },
    getAttribute(k) { return this._attrs[k]; },
    _on: {},
    addEventListener(t, f) { (this._on[t] ||= []).push(f); },
    querySelectorAll() { return []; },
    closest() { return null; },
    get innerHTML() { return _html; },
    set innerHTML(v) { _html = String(v); this.children.length = 0; },
  };
  return n;
}
const REG = new Map();
const node = id => { if (!REG.has(id)) REG.set(id, makeNode(id)); return REG.get(id); };

global.document = {
  title: '실시간 커뮤니티 온도',
  getElementById: id => node(id),
  createElement: () => makeNode(),
  createElementNS: () => makeNode(),
};
global.addEventListener = () => {};
// 데스크톱 폭으로 둔다. 좁은 폭 동작은 fitCharts 를 직접 불러 확인한다.
global.innerWidth = 1280;
global.confirm = () => true;
global.location = { hash: '' };
global.clearTimeout = () => {};
global.setTimeout = () => 0;
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({
  ticker: 'SNDK', total: 0, matched: 0, fear: 0, page: 0, pages: 0, size: 50, rows: [],
}) });
// SSE 는 붙지 않게 둔다 — 테스트는 paint() 를 직접 부른다
global.EventSource = class { constructor() { this.onmessage = null; this.onerror = null; } };

const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: k => store.delete(k),
};

/** 앱 스크립트를 새로 돌리고 내부 함수를 꺼내온다. */
export function run() {
  REG.clear(); store.clear();
  document.title = '실시간 커뮤니티 온도';
  const wrapped = CODE + `
;globalThis.__L = { spark, drawCharts, paint, card, UI, get LAST(){return LAST}, money, moneyShort, cur,
  sma, drawBars, drawFear, paintUnitSeg, viewRange, BAR, MIN_BARS, YSCALE, HAIRS, setTitle,
  tkRender, ema, macd, rsi, mfi, drawInd, fitCharts, fmtYMD, labRow, labName, P, niceTicks, nowLine, get ALERT(){return ALERT} };`;
  (0, eval)(wrapped);
  return { L: globalThis.__L, node };
}

/** 그려진 선(path)의 d 속성. 없으면 null. */
export function pathOf(svgId, nodeFn) {
  const el = nodeFn(svgId).children.find(c => c._attrs.d !== undefined);
  return el ? el._attrs.d : null;
}
