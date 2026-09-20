@echo off
setlocal
chcp 65001 >nul
rem auto/ui 작업칸에서 폰 화면 개선을 혼자 돌린다.
rem   auto-ui.bat [간격초]  (기본 900)
rem main 은 건드리지 않는다. push 도 하지 않는다 — 사람이 보고 합친다.

set "WT=%~dp0..\..\stock-sentiment-auto"
if not exist "%WT%\tools\claude-loop.bat" (
  echo auto/ui 작업칸이 없습니다. 먼저 이걸 치세요:
  echo   git worktree add ../stock-sentiment-auto -b auto/ui
  exit /b 1
)

set "EVERY=%~1"
if "%EVERY%"=="" set "EVERY=900"

rem 사람이 없는 자리에서 파일을 고치게 한다. 그래서 작업칸과 브랜치를 따로 뒀다.
set "CLAUDE_LOOP_FLAGS=--permission-mode acceptEdits"

call "%WT%\tools\claude-loop.bat" "지금 auto/ui 브랜치다. live.html 의 폰(390x844) 화면에서 개선할 점을 딱 하나만 골라 고쳐라. 고친 뒤 node tools/chart-touch-test.mjs 와 node tools/phone-flow-test.mjs 를 돌려 전부 통과하는지 확인하고, 통과하면 한국어로 커밋해라. push 는 절대 하지 마라. 고칠 것이 없으면 아무것도 바꾸지 말고 '없음' 한 단어만 답해라." %EVERY%
