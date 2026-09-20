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

rem 시험이 붙을 크롬. 없으면 띄운다.
curl -s -m 2 http://127.0.0.1:9222/json/version >nul 2>&1
if errorlevel 1 (
  echo 크롬을 띄웁니다 ^(9222^)
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new ^
    --remote-debugging-port=9222 --user-data-dir="%TEMP%\auto-ui-chrome" about:blank
  "%SystemRoot%\System32\timeout.exe" /t 4 /nobreak >nul
)

rem 작업칸 전용 서버(8741). 고친 live.html 을 실제로 받아 봐야 시험이 뜻이 있다.
rem 작업칸엔 data/ 가 없으니 본 폴더 것을 빌려 읽는다. 폴링은 하루로 밀어 사실상
rem 끈다 — 같은 데이터에 대고 두 서버가 토스를 두드리면 또 IP 가 막힌다.
curl -s -m 2 http://127.0.0.1:8741/ >nul 2>&1
if errorlevel 1 (
  echo 시험용 서버를 띄웁니다 ^(8741^)
  start "auto-ui server" /d "%WT%" cmd /c "set STOCK_DATA_DIR=%~dp0..\data&& node server.mjs --port 8741 --poll 86400"
  "%SystemRoot%\System32\timeout.exe" /t 8 /nobreak >nul
)

rem 접근키는 데이터 폴더에 있다. 본 폴더 것을 그대로 쓴다.
set /p KEY=<"%~dp0..\data\.access-key"
set "SITE=http://127.0.0.1:8741/?k=%KEY%"

rem acceptEdits 는 파일 수정만 자동 승인한다. 시험은 Bash 라 따로 열어야 한다 —
rem 안 열었더니 다섯 판을 "requires approval" 만 적고 돌았다.
rem push 는 열지 않는다. 사람이 보고 합친다.
set "CLAUDE_LOOP_FLAGS=--permission-mode acceptEdits --allowedTools Read Edit Write Glob Grep "Bash(node:*)" "Bash(git:*)" "Bash(curl:*)""

call "%WT%\tools\claude-loop.bat" "지금 auto/ui 브랜치의 별도 작업칸이다. live.html 의 폰(390x844) 화면에서 개선할 점을 딱 하나만 골라 고쳐라. 시험용 서버가 이 작업칸의 파일을 8741 로 내보내고 있고 크롬은 9222 에 떠 있다. 고친 뒤 반드시 이 둘을 돌려 전부 통과하는지 확인해라: node tools/chart-touch-test.mjs \"%SITE%\" 그리고 node tools/phone-flow-test.mjs \"%SITE%\". 고치기 전후 치수는 크롬을 직접 붙여 재서 근거로 삼아라 — 눈대중으로 좋아졌다고 하지 마라. 통과하면 한국어로 커밋해라. push 는 절대 하지 마라. 고칠 것이 없으면 아무것도 바꾸지 말고 '없음' 한 단어만 답해라." %EVERY%
