# 재는 쪽이 사는 곳.
#
# 왜 컨테이너인가: 스킬에 "재는 쪽은 고치지 않는다" 고 적어 놨지만 그건 부탁이다.
# 저장소를 읽기 전용으로 걸면 부탁이 아니라 사실이 된다 — 고치려 해도 못 고친다.
# 커밋도 푸시도 못 한다. 판정이 "고쳐 보니 되더라" 로 흐를 길이 막힌다.
#
# 쓸 수 있는 곳은 두 군데뿐이다: 장부(/repo/ops)와 긁적일 자리(/scratch).
FROM node:24-alpine

# git 은 읽기용으로 필요하다 — log · diff · show 로 언제 무엇이 바뀌었는지 본다.
# ripgrep 은 Claude Code 가 파일을 뒤질 때 쓴다.
RUN apk add --no-cache git ripgrep ca-certificates \
 && npm i -g @anthropic-ai/claude-code \
 && npm cache clean --force

# 저장소를 읽기 전용으로 걸 자리. 컨테이너 안에서 만들어 두면 마운트가 없어도 죽지 않는다.
# uid 가 안 맞아도 열리게 미리 만들어 둔다.
RUN mkdir -p /repo /ops /scratch && chmod 777 /ops /scratch

ENV OPS_LEDGER=/ops/ledger.jsonl \
    OPS_SCRATCH=/scratch \
    TZ=Asia/Seoul

USER node
WORKDIR /repo

# 붙으면 바로 재는 쪽으로 들어간다. 사람이 스킬 이름을 다시 칠 일이 없다.
CMD ["claude"]
