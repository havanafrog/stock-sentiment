@echo off
rem 이 PC 의 8731 을 오라클의 127.0.0.1:8731 로 내보낸다.
rem Caddy 가 havanafrog-stock.duckdns.org 를 localhost:8731 로 넘기므로,
rem 그 자리에 터널이 앉으면 사이트가 이 PC 의 server.mjs 를 보게 된다.
rem 토스가 오라클 IP 를 막아서, 수집은 집에서 나가고 주소만 오라클 것을 쓴다.
rem 오라클의 통은 내려 둬야 한다 - 포트가 겹치면 터널이 바로 끊긴다.
:loop
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -R 8731:127.0.0.1:8731 oracle-stock
rem 끊기면 10초 뒤 다시 건다. 인터넷이 깜빡여도 알아서 붙는다.
timeout /t 10 /nobreak >nul
goto loop