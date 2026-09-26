@echo off
rem Daily: re-fetch community posts into data/*.posts.json, then rebuild data/data.js
rem (analysis tab + live baselines). This PC's version of collect.sh - Toss blocks Oracle.
rem Scheduled task "gokso-collect" runs it daily at 15:20 KST (after US close).
rem Tickers come from data/tickers.json (both scripts read it). Days must match
rem --load-days in server-loop.bat. The server reloads data.js by itself - no restart.
rem Log: tools\collect.log
cd /d "%~dp0.."
echo ==== start %date% %time% >> tools\collect.log
node --max-old-space-size=512 fetch-comments.mjs --days 90 >> tools\collect.log 2>&1 || goto fail
node --max-old-space-size=512 build.mjs --days 90 >> tools\collect.log 2>&1 || goto fail
echo ==== done %date% %time% >> tools\collect.log
exit /b 0
:fail
echo ==== FAIL %date% %time% >> tools\collect.log
exit /b 1
