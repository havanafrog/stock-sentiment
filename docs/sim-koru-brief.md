# KORU 깊이 보기 — 지시서 (2차 시뮬레이션)

1차(docs/sim-report.md)는 4종목을 넓게 봤고 "곡소리 뒤 사면 낫다는 증거 없음"이었다.
2차는 KORU 하나만 깊게 본다. 목적은 둘이다: 지표를 더 정확히 재는 것, 그리고 agentsemble
팀 흐름(sim 이 만들고 → 장부 주장 → review 가 검증 → main 이 합침)을 끝까지 한 바퀴 돌리는 것.

## 질문

KORU 에서 곡소리 지표가 다음 몇 시간 가격 방향을 조금이라도 알려 주나? 사는 쪽이든 피하는 쪽이든.

## 할 일 (sim)

기존 `tools/sim/replay.mjs`·`backtest.mjs`·`prices.mjs` 를 그대로 쓴다. 새 파일은 `tools/sim/koru.mjs` 하나.

1. **사건 연구** — 신호 봉 다음 H∈{1,3,6,12} 봉 수익의 평균과 부트스트랩 95% 구간(1000번).
   방향은 둘 다: 곡소리 뒤 매수(long), 곡소리 뒤 회피·매도(short = 부호 반대). 수수료 편도 0.1%.
2. **신호 셋 비교** — 곡소리 비율 급등, 감성 점수(sent) 급락, 댓글 수(n) 급증. 같은 k∈{1,1.5,2}, 직전 24봉 기준선.
3. **시간대 맞춘 무작위** — 무작위 진입을 신호 봉과 같은 시(UTC hour)에서만 뽑는다. 댓글이 미국 장 시간에 몰려서 1차 비교가 시간대 효과를 섞었을 수 있다.
4. **MIN_N 민감도** — {5, 10, 20} 으로 결과가 뒤집히는지.
5. 점검 `tools/sim/sim.test.mjs` 에 koru.mjs 몫을 더한다 (부트스트랩 구간이 고정 seed 에서 같은 값, 시간대 맞춘 후보가 같은 hour 만, short 수익 = long 의 부호 반대에 수수료 반영).
6. 보고서는 `docs/sim-report.md` 끝에 "## KORU 깊이 보기" 절로 붙인다. 결론 먼저, 표는 그 아래.

## 장부와 넘김

- 장부는 main 폴더 것을 같이 쓴다: `OPS_LEDGER=../../stock-sentiment/ops/ledger.jsonl node ops/ledger.mjs ...`
- 보고서의 핵심 결론마다 주장 하나: `claim "주장" --how "재는 명령" --files tools/sim/koru.mjs,docs/sim-report.md`.
  `--how` 는 main 폴더에서 그대로 붙여 돌릴 수 있는 명령이어야 한다. review 는 main 폴더에서 돌고
  코드는 아직 agent/sim 에만 있으니 `cd ../stock-sentiment-team/sim && STOCK_DATA_DIR=../../stock-sentiment/data node tools/sim/koru.mjs ...` 꼴로.
- 주장 번호를 review 에게 SendMessage 로 한 줄 보낸다. review 창이 없으면 main 에게 보낸다.
- 커밋은 단계마다, 가지는 agent/sim. main 병합은 하지 않는다.

## review 가 할 일

- 주장마다 `--how` 를 직접 돌려 숫자가 맞는지, 미래 정보가 섞이지 않았는지, 무작위 비교가 공정한지 본다.
- `verdict C# 확인|반박|보류 "근거" --by verifier`. 파일은 고치지 않는다.
- 끝나면 main 에게 한 줄.

## 한계 (보고서에 적을 것)

3주치, 레버리지 ETF 하나, 장외 봉. 투자 조언이 아니라 지표 검증이다.
