# 판이 사는 곳.
#
# 재는 쪽 통(Dockerfile)과 따로 둔다. 판은 Claude 를 안 쓴다 — node 만 있으면 된다.
# 같은 이미지를 쓰면 576MB 짜리를 하나 더 띄우는 셈이다.
#
# 판은 읽기만 한다. 저장소도 장부도 기록도 전부 읽기 전용으로 건다.
FROM node:24-alpine

# 판이 마지막 커밋과 안 올린 파일을 보여 준다. 그러려면 git 이 있어야 한다.
RUN apk add --no-cache git

ENV TZ=Asia/Seoul \
    OPS_LEDGER=/ops/ledger.jsonl \
    OPS_LOG_DIR=/logs \
    STOCK_DATA_DIR=/repo/data

# 마운트가 없어도 죽지 않게 자리를 미리 만든다.
RUN mkdir -p /repo /ops /logs

USER node
# 마운트한 저장소는 소유자가 달라 git 이 'dubious ownership' 이라며 거부한다.
# 읽기만 하므로 안전하다고 알려 준다.
RUN git config --global --add safe.directory /repo

WORKDIR /repo
EXPOSE 8730

# 0.0.0.0 이 아니라 통 안의 모든 주소로 듣는다 — 밖으로는 compose 가 127.0.0.1 에만 건다.
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8730/api/board').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "/repo/ops/board.mjs"]
CMD ["--host", "0.0.0.0"]
