@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
  echo 正在启动本地服务器 http://localhost:8080 ...
  start "抢车狂人 - 本地服务器" cmd /c "python serve.py 8080"
  timeout /t 1 /nobreak >nul
  start "" "http://localhost:8080"
  exit /b 0
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo 正在启动本地服务器 http://localhost:8080 ...
  start "抢车狂人 - 本地服务器" cmd /c "npx --yes serve -l 8080 ."
  timeout /t 2 /nobreak >nul
  start "" "http://localhost:8080"
  exit /b 0
)

echo 需要安装 Python 或 Node.js 才能启动本地服务器。
echo 也可以把整个目录上传到任意静态托管网站直接玩。
pause
