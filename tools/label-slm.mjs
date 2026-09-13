// 로컬 SLM(ollama)으로 글에 긍정·중립·부정 라벨을 찍는다.
//
// 이 저장소에는 기존 15,813건을 찍은 프롬프트가 남아 있지 않다. 그래서 여기에 프롬프트와
// 모델 이름을 결과 줄마다 같이 적는다 — 나중에 어느 선생이 찍은 라벨인지 섞이면
// 학습 자료가 조용히 오염된다.
//
//   node tools/label-slm.mjs                     data/*.live.jsonl 전부
//   node tools/label-slm.mjs --limit 50          앞 50건만 (시험용)
//   node tools/label-slm.mjs --model exaone3.5:2.4b
//
// 결과는 data/labels-slm-live.jsonl 에 한 줄씩 붙는다. 이미 찍은 id 는 건너뛰므로
// 중간에 끊어도 다시 돌리면 이어서 간다.
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const MODEL = arg('--model', 'exaone3.5:7.8b');
const LIMIT = +arg('--limit', 0);
const OUT = arg('--out', 'data/labels-slm-live.jsonl');
const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// 한 글자만 받는다. 설명을 붙이기 시작하면 파싱이 프롬프트 튜닝이 된다.
const PROMPT = `너는 한국 주식 커뮤니티 글을 긍정·부정·중립으로 나눈다.

P(긍정): 오르길 바라거나, 오를 것 같다고 보거나, 수익을 자랑하거나, 종목을 응원한다.
N(부정): 떨어질 것 같다고 보거나, 손실·물림을 한탄하거나, 화내거나, 비꼬거나, 종목·회사를 욕한다.
X(중립): 질문, 사실 전달, 종목과 상관없는 잡담. 이 셋 중 하나일 때만 X 다.

규칙:
1. 바람·명령문은 어조로 가른다. 순한 바람·응원은 P("올랐으면 좋겠다ㅠㅠ", "가보자고").
   재촉·짜증·핀잔이 섞이면 N("그만 좀 하고 올라가라", "언제까지 이럴래ㅡㅡ").
2. 욕설·비속어는 감정의 세기지 방향이 아니다. 종목에 욕을 해도 오르길 바라는 문맥이면 P.
3. 후회·자조·푸념·체념은 N 이다("그때 팔걸", "난이도 헬이네;;", "이제 안 본다").
   비꼼과 반어도 N 이다 — 웃고 있어도 상황을 비웃는 것이면 N("잘도 오르겠네ㅋㅋ").
   질문 모양이어도 손실·실망이 깔려 있으면 N("여기 -50퍼 있나요?").
4. 응원 구호, 안 팔겠다는 다짐, 오를 거라는 예측은 P 다("안 판다", "본장 가면 800이다").
   손실을 말해도 회복·안도로 끝나면 P 다("생각보다 안 빠졌네").
5. 웃음·감탄만 있고 방향이 없으면 X("ㅋㅋㅋㅋ", "허허").
   감정 없는 사실·시각·매매 계획도 X 다("나는 1120 오면 들어간다").

이 다섯에 걸리지 않으면 X 를 아끼라. 감정이 실려 있으면 P 나 N 이다.

보기:
"드디어 익절 ㅋㅋ" → P
"이 종목 미친놈아 사랑한다" → P
"또 물렸다 하 진짜" → N
"올라가라고 좀ㅡㅡ 답답하네" → N
"ㅋㅋㅋㅋㅋㅋㅋ" → X
"나는 1120 오면 들어간다" → X

P, N, X 중 한 글자만 답한다. 다른 말은 쓰지 않는다.

글: `;

// 프롬프트를 고치면 선생이 바뀐 것이다. 어느 판이 찍었는지 줄마다 남겨야 나중에 가린다.
const PV = createHash('sha256').update(PROMPT).digest('hex').slice(0, 8);

async function label(text) {
  const r = await fetch(`${HOST}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({
      model: MODEL,
      prompt: PROMPT + text + '\n답: ',
      stream: false,
      options: { temperature: 0, num_predict: 3 },
    }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const out = (await r.json()).response || '';
  const m = out.toUpperCase().match(/[PNX]/);
  return m ? m[0] : null;
}

function corpus() {
  const seen = new Set();
  const rows = [];
  for (const f of readdirSync('data').filter(f => f.endsWith('.live.jsonl')))
    for (const line of readFileSync(`data/${f}`, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }   // 수집 중이면 마지막 줄이 잘려 있다
      const text = String(r.text || '').trim();
      if (!text || seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push({ t: f.split('.')[0], id: r.id, at: r.at, text });
    }
  return rows;
}

// --gold 는 사람이 읽어 찍은 파일로 프롬프트 자체를 잰다. 새 라벨을 찍기 전에
// 선생이 예전 선생보다 나은지부터 봐야 한다. 같은 240건, 같은 사람 자다.
const GOLD = arg('--gold', null);
if (GOLD) {
  // SKIP 으로 앞부분을 건너뛴다. 프롬프트를 앞 90건으로 깎았으니 최종 점수는
  // 손대지 않은 나머지로 내야 한다. 같은 글로 깎고 재면 잰 숫자가 거짓말이 된다.
  const SKIP = +arg('--skip', 0);
  const rows = JSON.parse(readFileSync(GOLD, 'utf8')).slice(SKIP, LIMIT ? SKIP + LIMIT : Infinity);
  const hit = { now: 0, was: 0 };
  const conf = {};                                   // 사람라벨 → 새라벨 → 건수
  for (const r of rows) {
    const y = await label(r.text).catch(() => null);
    (conf[r.y] ??= {})[y ?? '?'] = ((conf[r.y] ??= {})[y ?? '?'] ?? 0) + 1;
    if (y === r.y) hit.now++;
    if (r.slm === r.y) hit.was++;
    // 틀린 것을 눈으로 봐야 프롬프트를 감으로 고치지 않는다.
    if (y !== r.y) appendFileSync(OUT, JSON.stringify({ id: r.id, text: r.text, 사람: r.y, 새: y, 기존: r.slm }) + '\n');
  }
  const pc = n => `${(n / rows.length * 100).toFixed(1)}%`;
  console.log(`${MODEL} · ${rows.length}건 · 이 프롬프트 ${pc(hit.now)} / 기존 라벨 ${pc(hit.was)}`);
  for (const y of ['P', 'N', 'X']) console.log(`  사람 ${y} → ${JSON.stringify(conf[y] ?? {})}`);
  process.exit(0);
}

const done = new Set();
if (existsSync(OUT)) for (const line of readFileSync(OUT, 'utf8').split('\n')) {
  if (line.trim()) try { done.add(JSON.parse(line).id); } catch { }
}

let todo = corpus().filter(r => !done.has(r.id));
if (LIMIT) todo = todo.slice(0, LIMIT);
console.log(`${MODEL} · 찍을 것 ${todo.length}건 (이미 ${done.size}건)`);

// GPU 하나라 동시에 던져도 줄만 선다. 실패 한 건이 나머지를 죽이지 않게만 감싼다.
const t0 = Date.now();
let n = 0, bad = 0;
for (const r of todo) {
  let y = null;
  try { y = await label(r.text); } catch (e) { bad++; console.error(`${r.id}: ${e.message}`); continue; }
  if (!y) { bad++; continue; }
  appendFileSync(OUT, JSON.stringify({ ...r, y, model: MODEL, pv: PV }) + '\n');
  if (++n % 25 === 0) {
    const s = (Date.now() - t0) / 1000;
    console.log(`${n}/${todo.length}  ${(n / s).toFixed(2)}건/초  남은 ${((todo.length - n) / (n / s) / 60).toFixed(1)}분`);
  }
}
console.log(`끝. ${n}건 찍음, ${bad}건 실패, ${((Date.now() - t0) / 1000).toFixed(0)}초`);
