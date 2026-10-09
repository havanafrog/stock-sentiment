# 시뮬레이션 과제 — 곡소리가 터진 뒤 사면 나았나

agentsemble 팀 시험을 겸한 연구 과제. 투자 조언이 아니라 지표 검증이다.

## 질문

곡소리 비율(부정 글 비율)이 평소보다 크게 튄 뒤에 사서 N시간 들고 있으면,
그냥 들고 있기·무작위로 사기보다 나았나?

## 데이터 (읽기만)

- 댓글: `data/<종목>.live.jsonl` — 한 줄에 `{id, at, text, likes, img}`. 9/21 부터.
  `data/` 는 git 에 없다. 작업칸에서는 `STOCK_DATA_DIR` 을 main 폴더의 `data` 로 준다:
  `STOCK_DATA_DIR="../../stock-sentiment/data"` (paths.mjs 가 읽는다). **절대 쓰지 않는다.**
- 채점: `lexicon.js` 를 server.mjs 처럼 `new Function('window', …)` 로 읽어
  `isWail(text)` (곡소리), `scoreModel`/`scoreWith` (감성) 을 쓴다. model.json 이 있으면 분류기.
- 가격: `toss.mjs` 의 `resolveStock(ticker)` → `fetchBars(code, 'min:60', 450)`.
  받은 봉은 `tools/sim/cache/` 에 저장해 다시 받지 않는다(이 폴더는 .gitignore).

## 만들 것 — 전부 `tools/sim/` 아래

1. `replay.mjs` — 댓글을 시간봉에 맞춰 묶어 봉마다 `{t, n, wail, wailRatio, sent}` 계열을 낸다.
2. `backtest.mjs` — 규칙: 곡소리 비율이 직전 24봉 평균 + k·표준편차를 넘으면 다음 봉 시가에 사서
   H봉 뒤 종가에 판다. 수수료 편도 0.1%. 겹치는 진입은 하나로 친다.
   - 기준: 같은 기간 그냥 들고 있기, 같은 횟수 무작위 진입(시드 고정, 1000번 평균과 분위).
   - 걷기 검증: 앞 절반에서 k ∈ {1,1.5,2}, H ∈ {1,3,6,12} 중 고르고 뒤 절반에서만 성적을 잰다.
3. `sim.test.mjs` — 작은 가짜 계열로 진입·청산·수수료·겹침·미래 정보 안 씀을 재는 점검.
   `node tools/sim/sim.test.mjs` 로 돈다.
4. `docs/sim-report.md` — 종목별 표(거래 수, 평균 수익, 승률, 최대 낙폭, 무작위 대비 분위),
   뒤 절반 성적, 한계(3주치, 레버리지 ETF, 장외 시간 댓글) 를 적는다. 숫자마다 재는 명령을 붙인다.

## 지키는 것

- 고치는 파일은 `tools/sim/`, `docs/sim-report.md`, `.gitignore`(cache 한 줄) 뿐. 나머지는 읽기만.
- 화면(live.html)·서버·모델은 건드리지 않는다.
- 미래 정보 금지: 봉 t 의 신호는 t 까지의 댓글만 쓴다.

## 끝났다는 것

`node tools/sim/sim.test.mjs` 통과, `node tools/sim/backtest.mjs` 가 보고서 숫자를 그대로 다시 낸다.
review 가 장부에서 판정한다.
