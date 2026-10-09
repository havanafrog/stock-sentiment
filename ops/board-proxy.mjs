// Docker Desktop 에서 켜는 판의 입구. 판 본체는 이 PC 에서 돈다(로그인 때 시작프로그램이 띄움).
//
// 왜 둘로 나누나: 판이 통 안에 있으면 PC 의 CLI 창을 못 연다. 윈도우 폴더도 통에서 읽으면
// 느리다(요청 하나 40초). 그래서 읽기와 창 열기는 PC 의 판이 하고, 통은 받은 요청을 넘기기만 한다.
//
//   통 :8740  →  host.docker.internal:8745 (PC 의 판)
//
// 판은 Host 와 Origin 을 본다(남의 페이지가 대화를 읽거나 창을 열지 못하게). 그래서 넘길 때
// 판이 아는 주소로 바꿔 단다. 브라우저가 판 화면에서 보낸 Origin 만 바꾸고, 나머지는 그대로 둔다 —
// 남의 페이지에서 온 요청은 판이 그대로 막는다.
import { createServer, request } from 'node:http';

const LISTEN = 8740;
const TARGET = { host: process.env.BOARD_HOST ?? 'host.docker.internal', port: Number(process.env.BOARD_PORT ?? 8745) };
const FRONT = new Set([`http://127.0.0.1:${LISTEN}`, `http://localhost:${LISTEN}`]);
const BACK = `127.0.0.1:${TARGET.port}`;

createServer((req, res) => {
  const headers = { ...req.headers, host: BACK };
  if (req.headers.origin && FRONT.has(req.headers.origin)) headers.origin = `http://${BACK}`;
  const up = request({ ...TARGET, method: req.method, path: req.url, headers }, r => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('PC 의 판이 안 떠 있습니다. 시작프로그램의 agentsemble-board.vbs 를 실행하거나 다시 로그인하세요.');
  });
  req.pipe(up);
}).listen(LISTEN, '0.0.0.0', () => console.log(`판 입구 http://127.0.0.1:${LISTEN} → PC ${TARGET.host}:${TARGET.port}`));
