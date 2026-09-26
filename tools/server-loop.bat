@echo off
rem 실시간 서버. 죽으면 10초 뒤 다시 띄운다.
rem 토스로 나가는 요청이 이 PC 에서 나가야 한다 - 오라클 IP 는 차단됐다.
rem repo = one level up from this file. No hardcoded path, so the folder can move.
rem 인자는 docker-compose.yml 의 command 와 맞춘다. 빼면 --load-days 가 5 로 떨어져
rem 실시간 글이 5일치만 남고 잘린다 (2026-09-26 에 그렇게 한 달을 잃었다).
cd /d "%~dp0.."
:loop
node server.mjs --poll 5 --load-days 90 --posts-days 7
timeout /t 10 /nobreak >nul
goto loop
