@echo off
rem WARS - launcher. The game is pure file:// HTML, so this just opens index.html.
rem   run.bat          open in your default browser
rem   run.bat serve    serve over HTTP instead (http://localhost:8080)
rem   run.bat serve 9000
setlocal
cd /d "%~dp0"

if /i "%~1"=="serve" goto serve
start "" "%~dp0index.html"
goto end

:serve
set PORT=%~2
if "%PORT%"=="" set PORT=8080
echo WARS on http://localhost:%PORT%   (ctrl-c to stop)
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto end
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server %PORT%
  goto end
)
echo Need Python installed to serve. Or just double-click index.html.

:end
endlocal