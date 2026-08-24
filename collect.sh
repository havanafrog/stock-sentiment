#!/bin/sh
# 하루 한 번 커뮤니티 글을 다시 긁어 posts.json 에 흡수시키고 기준선을 다시 만든다.
#
# 서버는 5초마다 새 글을 받아 .live.jsonl 에 붙이지만 그쪽은 --load-days 치만
# 남기고 잘린다. 장기 이력은 여기서 챙긴다. 안 돌리면 차트의 지난 30일이
# 마지막으로 이걸 돌린 날에서 멈춘다.
#
# 종목은 data/tickers.json 에서 읽는다. 여기 손으로 박아 두면 화면에서 종목을
# 늘렸을 때 그 종목만 조용히 빠진다 — 실제로 MRNA 가 이틀 동안 그랬다.
#
# 호스트 crontab 에 건다:
#   20 6 * * * /home/ubuntu/stock-docker/collect.sh
#   (06:20 UTC = 15:20 KST — 미국 장 마감 뒤)
#
# 기간(90일)은 서버의 --load-days 와 맞춰야 한다. 여기가 짧으면 매일 새벽
# 아카이브가 그만큼 잘려서, 애써 모은 과거가 하룻밤에 사라진다.
#
# 20만 건을 병합하며 힙이 250MB 쯤 든다. 이미지 기본값(384MB)으로도 되지만
# 종목이 늘면 아슬해서 여기서 올려 준다.
#
# 로그: ~/collect.log
set -e
cd "$(dirname "$0")"
exec sudo docker compose exec -T stock \
  sh -c 'T=$(node -e "console.log(JSON.parse(require(\"fs\").readFileSync(process.env.STOCK_DATA_DIR + \"/tickers.json\", \"utf8\")).join(\" \"))") \
         && echo "종목: $T" \
         && node --max-old-space-size=512 fetch-comments.mjs $T --days 90 \
         && node --max-old-space-size=512 build.mjs --days 90' \
  >> "$HOME/collect.log" 2>&1
