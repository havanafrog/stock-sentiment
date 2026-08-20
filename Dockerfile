# 의존성이 없다. node 표준 라이브러리만 쓴다 — npm install 단계도, 빌드 단계도 없다.
FROM node:24-alpine

# 이 기계는 작다. 자식(fetch-comments·build)도 힙을 묶어 두므로
# 서버 몫만 여기서 잡는다.
ENV NODE_OPTIONS=--max-old-space-size=384 \
    STOCK_DATA_DIR=/data \
    TZ=Asia/Seoul

WORKDIR /app

# 코드는 이미지에, 남는 것은 볼륨에. 섞으면 갱신할 때마다 데이터가 위험해진다.
COPY paths.mjs toss.mjs tickers.mjs lexicon.js \
     server.mjs build.mjs fetch-comments.mjs \
     live.html index.html data.js logo-128.png ./

# 볼륨을 안 걸고 띄워도 죽지는 않게. 걸면 이 자리를 덮어쓴다.
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 8731

# 컨테이너 안에서 도는 것이므로 0.0.0.0 으로 듣는다. 밖에 그대로 열지는 말고
# 리버스 프록시를 앞에 둔다 — 접근키는 있지만 TLS 는 없다.
HEALTHCHECK --interval=30s --timeout=4s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8731/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "server.mjs"]
CMD ["--poll", "5", "--load-days", "5"]
