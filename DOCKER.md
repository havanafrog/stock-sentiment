# Docker 로 돌리기

의존성이 없다. node 표준 라이브러리만 쓰므로 `npm install` 단계도 빌드
단계도 없다.

```bash
docker compose up -d
```

`127.0.0.1:8731` 에만 연다. 밖에 그대로 열지 말고 앞에 Caddy 나 nginx 를
두고 TLS 를 붙인다 — 접근키는 링크를 아는 사람만 막을 뿐 평문은 그대로
흐른다.

접근키는 볼륨 안 `.access-key` 에 있다.

```bash
docker compose exec stock cat /data/.access-key
```

## 첫 실행

기준선(`data.js`)은 이미지에 딸려 온다. 그래서 아무것도 안 해도 화면은
뜬다. 다만 그 기준선은 이미지를 만든 시점의 것이라, 종목을 바꿨거나 시간이
꽤 지났으면 다시 만든다.

```bash
docker compose exec stock node fetch-comments.mjs SNDK SNXX MU MUU KORU --days 30
docker compose exec stock node build.mjs --days 30
```

30일치 다섯 종목이면 40~60분 걸린다. 그동안에도 서버는 계속 응답한다.

종목을 화면(사용법 › 종목 관리)에서 추가하면 이 두 단계가 알아서 돈다.

## 볼륨

남는 것은 `stock-data` 볼륨 하나다.

```
/data/{티커}.posts.json    수집한 글 원본
/data/{티커}.live.jsonl    실시간으로 받은 글 (읽을 때 위와 합친다)
/data/data.js              기준선
/data/tickers.json         종목 목록
/data/series.json          지수 이력
/data/.access-key          접근키
```

볼륨 이름은 compose 파일에 `name: stock-data` 로 못 박아 뒀다. 안 그러면
compose 가 폴더 이름을 앞에 붙여 다른 볼륨을 새로 만든다 — 글도 접근키도
없는 빈 볼륨이라 링크가 죽고 처음부터 다시 모은다.

백업:

```bash
docker run --rm -v stock-data:/data -v "$PWD:/out" alpine \
  tar czf /out/stock-data.tgz -C /data .
```

## 부팅 때 뜨게

`restart: unless-stopped` 는 도커가 이미 돌고 있을 때만 소용이 있다.
부팅 직후에 compose 를 부르는 건 따로 필요하다.

```ini
# /etc/systemd/system/stock-docker.service
[Unit]
Description=stock-sentiment (docker compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/stock-docker
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

## 갱신

```bash
docker compose build && docker compose up -d
```

코드는 이미지에, 데이터는 볼륨에 있어 이미지를 갈아도 글은 남는다.

## 메모리

오라클 Always Free(1GB)에서 도는 걸 전제로 `mem_limit: 700m` 을 걸어 뒀다.
평소 30~80MB 를 쓰고, 수집 자식이 붙는 순간이 제일 무겁다. 자식 힙은
`--max-old-space-size=256` 으로 따로 묶여 있다.

## 도커 없이 그냥 돌리기

바뀐 게 없다.

```bash
node server.mjs --poll 5 --load-days 5
```

`STOCK_DATA_DIR` 을 안 주면 예전 그대로 `./data` 를 쓴다.
