@echo off
setlocal
rem 글자표를 UTF-8 로 맞춘다. 안 그러면 기록에 한글이 깨진다.
chcp 65001 >nul
rem 프롬프트 하나를 정해진 간격으로 계속 다시 던진다.
rem   claude-loop.bat "해야 할 일" [간격초] [횟수]
rem 첫 판은 새 대화, 두 번째부터는 -c 로 같은 대화를 이어간다.
rem 도구 권한을 미리 열어 두지 않으면 편집 단계에서 멈춘다. README 참고.
set "PROMPT=%~1"
if "%PROMPT%"=="" set "PROMPT=이어서 진행해. 남은 UI 개선 하나를 골라 고치고 커밋해."
set "EVERY=%~2"
if "%EVERY%"=="" set "EVERY=900"
set "TIMES=%~3"
if "%TIMES%"=="" set "TIMES=0"

set "ROOT=%~dp0.."
set "LOG=%~dp0claude-loop.log"
set "CONT="
set /a N=0

:loop
set /a N+=1
echo.>> "%LOG%"
echo ===== %date% %time%  (%N%회차) =====>> "%LOG%"
pushd "%ROOT%"
claude -p %CONT% %CLAUDE_LOOP_FLAGS% "%PROMPT%">> "%LOG%" 2>&1
popd
set "CONT=-c"
if not "%TIMES%"=="0" if %N% GEQ %TIMES% goto done
rem 같은 이름의 다른 timeout 이 PATH 앞에 있을 수 있다. 윈도 것을 집어 부른다.
"%SystemRoot%\System32\timeout.exe" /t %EVERY% /nobreak >nul 2>&1 || "%SystemRoot%\System32\ping.exe" -n %EVERY% 127.0.0.1 >nul
goto loop

:done
echo ===== 끝 (%N%회) =====>> "%LOG%"
