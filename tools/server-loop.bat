@echo off
rem 실시간 서버. 죽으면 10초 뒤 다시 띄운다.
rem 토스로 나가는 요청이 이 PC 에서 나가야 한다 - 오라클 IP 는 차단됐다.
cd /d "C:\Users\lgjgo\OneDrive\Desktop\MAIN\stock-sentiment"
:loop
node server.mjs
timeout /t 10 /nobreak >nul
goto loop