@echo off
setlocal
rem Safe here only because every line of this file is ASCII: the offsets cmd
rem re-reads by do not shift. The Korean prompt file needs it to load intact.
chcp 65001 >nul
rem   auto-ui.bat [seconds]   default 900
rem
rem Runs the phone-UI loop inside the auto/ui worktree. main is untouched and
rem nothing is pushed - a human reviews and merges.
rem
rem THIS FILE IS ASCII ON PURPOSE. cmd re-reads a .bat by byte offset, so a
rem chcp in the middle of the file desyncs every following line that holds
rem multibyte text - even a rem line gets run as a command. The Korean prompt
rem therefore lives in auto-ui-prompt.txt and is read at runtime.
rem Also note \" is not an escape in cmd, so no quotes go inside the prompt.

set "WT=%~dp0..\..\stock-sentiment-auto"
set "MAIN=%~dp0.."
if not exist "%WT%\tools\claude-loop.bat" goto nowt
if not exist "%~dp0auto-ui-prompt.txt" goto noprompt

set "EVERY=%~1"
if "%EVERY%"=="" set "EVERY=900"

curl -s -m 2 http://127.0.0.1:9222/json/version >nul 2>&1
if errorlevel 1 call :chrome

curl -s -m 2 http://127.0.0.1:8741/ >nul 2>&1
if errorlevel 1 call :server

set /p KEY=<"%MAIN%\data\.access-key"
set "SITE=http://127.0.0.1:8741/?k=%KEY%"

rem acceptEdits only auto-approves file edits. The tests are Bash, so they need
rem their own opening - without it the loop spent five rounds writing
rem "requires approval" and never committed. push stays closed.
set "CLAUDE_LOOP_FLAGS=--permission-mode acceptEdits --allowedTools Read Edit Write Glob Grep "Bash(node:*)" "Bash(git:*)" "Bash(curl:*)""

set "PROMPT="
for /f "usebackq delims=" %%L in ("%~dp0auto-ui-prompt.txt") do if not defined PROMPT set "PROMPT=%%L"
call set "PROMPT=%%PROMPT:SITE=%SITE%%%"

call "%WT%\tools\claude-loop.bat" "%PROMPT%" %EVERY%
goto :eof

:chrome
echo starting chrome on 9222
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9222 --user-data-dir="%TEMP%\auto-ui-chrome" about:blank
"%SystemRoot%\System32\timeout.exe" /t 4 /nobreak >nul
goto :eof

rem The worktree has no data/ of its own, so it borrows main's read-only and
rem polling is pushed out to a day - two servers hammering Toss got the last
rem IP blocked.
:server
echo starting test server on 8741
start "auto-ui server" /d "%WT%" cmd /c "set STOCK_DATA_DIR=%MAIN%\data&& node server.mjs --port 8741 --poll 86400"
"%SystemRoot%\System32\timeout.exe" /t 8 /nobreak >nul
goto :eof

:noprompt
echo auto-ui-prompt.txt missing next to this script.
exit /b 1

:nowt
echo worktree missing. run this first:
echo   git worktree add ../stock-sentiment-auto -b auto/ui
exit /b 1
