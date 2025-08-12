@echo off
setlocal
cd /d "%~dp0GlycoTank-web"
echo.
echo Starting GlycoTank (local)...
where node >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" http://localhost:8080/
  npx --yes http-server . -p 8080 -c-1
  goto :eof
)
where py >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" http://localhost:8080/
  py -3 -m http.server 8080
  goto :eof
)
where python >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" http://localhost:8080/
  python -m http.server 8080
  goto :eof
)
echo Node/Python not found. Opening directly (no service worker)...
start "" "%cd%\index.html"
