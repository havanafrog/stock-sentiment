#!/bin/sh
# 하루 한 번 커뮤니티 글을 다시 긁어 posts.json 에 흡수시키고 기준선을 다시 만든다.
#
# 서버는 5초마다 새 글을 받아 .live.jsonl 에 붙이지만 그쪽은 --load-days 치만
# 남기고 잘린다. 장기 이력은 여기서 챙긴다. 안 돌리면 차트의 지난 30일이
# 마지막으로 이걸 돌린 날에서 멈춘다.
#
# 호스트 crontab 에 건다:
#   20 6 * * * /home/ubuntu/stock-docker/collect.sh
#   (06:20 UTC = 15:20 KST — 미국 장 마감 뒤)
#
# 로그: ~/collect.log
set -e
cd "$(dirname "$0")"
exec sudo docker compose exec -T stock \
  sh -c "node fetch-comments.mjs SNDK SNXX MU MUU KORU --days 30 && node build.mjs --days 30" \
  >> "$HOME/collect.log" 2>&1
