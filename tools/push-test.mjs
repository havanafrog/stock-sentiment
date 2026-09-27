// 그 종목 알림을 켠 폰에 '[시험]' 알림을 보낸다. 실제 폰 확인용.
//   node tools/push-test.mjs SNDK
// 서버와 같은 data/(STOCK_DATA_DIR) 의 키·구독을 읽는다. 서버는 안 켜 있어도 된다.
import { readFileSync, existsSync } from 'node:fs';
import { dataPath } from '../paths.mjs';
import { send } from '../push.mjs';

const t = (process.argv[2] ?? '').toUpperCase();
if (!t) { console.error('쓰는 법: node tools/push-test.mjs <티커>'); process.exit(2); }
if (!existsSync(dataPath('.vapid.json')) || !existsSync(dataPath('push.json'))) {
  console.error('키나 구독이 없습니다. 서버를 한 번 켜고 폰에서 알림을 켜세요.'); process.exit(1);
}
const vapid = JSON.parse(readFileSync(dataPath('.vapid.json'), 'utf8'));
const subs = Object.entries(JSON.parse(readFileSync(dataPath('push.json'), 'utf8')).subs ?? {})
  .filter(([, s]) => s.tickers.includes(t));
if (!subs.length) { console.error(`${t} 알림을 켠 구독이 없습니다.`); process.exit(1); }

for (const [endpoint, s] of subs) {
  const code = await send({ endpoint, keys: s.keys },
    { t, idx: 0, test: true, title: `[시험] ${t} 곡소리`, body: '알림이 잘 오는지 보는 시험입니다.' },
    vapid, { subject: 'https://github.com/havanafrog/stock-sentiment', topic: `wail-${t}` });
  console.log(`  ${code >= 200 && code < 300 ? 'OK ' : 'ERR'} ${code}  ${endpoint.slice(0, 40)}…`);
}
