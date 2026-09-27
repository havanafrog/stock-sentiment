// 사람 라벨(#label200)을 찍는 사람용 링크를 찍는다. 접근키 + 라벨 키가 다 들어 있다.
//   node tools/label-link.mjs                  deploy/.env 의 SITE_HOST 로
//   node tools/label-link.mjs https://주소      주소를 직접
// 이 링크는 커밋하지도, 로그·대화에 붙이지도 않는다 — 폰으로 옮길 때만 쓴다.
// 키는 서버가 처음 켤 때 data/ 에 만든다. 서버를 한 번도 안 켰으면 없다.
import { readFileSync, existsSync } from 'node:fs';
import { dataPath } from '../paths.mjs';

const read = f => existsSync(dataPath(f)) ? readFileSync(dataPath(f), 'utf8').trim() : null;
const k = read('.access-key'), lk = read('.label-key');
if (!k || !lk) { console.error('키가 없습니다. 서버를 한 번 켠 뒤 다시 돌리세요.'); process.exit(1); }

let base = process.argv[2] ?? process.env.SITE_HOST ?? null;
if (!base && existsSync('deploy/.env')) {
  base = readFileSync('deploy/.env', 'utf8').match(/^SITE_HOST=(.+)$/m)?.[1]?.trim() ?? null;
}
if (!base) { console.error('주소를 모릅니다. node tools/label-link.mjs https://주소 처럼 넘기세요.'); process.exit(2); }
if (!/^https?:\/\//.test(base)) base = 'https://' + base;

console.log(`${base.replace(/\/+$/, '')}/?k=${encodeURIComponent(k)}&lk=${encodeURIComponent(lk)}#label200`);
