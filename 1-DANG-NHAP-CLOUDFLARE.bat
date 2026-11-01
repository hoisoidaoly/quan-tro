@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Chua cai Node.js.
  echo      Mo https://nodejs.org , tai ban LTS, cai dat xong thi chay lai file nay.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)

echo.
echo  === Buoc 1: Dang nhap Cloudflare ===
echo  Trinh duyet se mo ra. Dang nhap DUNG tai khoan dang chua
echo  quantro.hoisoidaoly.workers.dev roi bam "Allow".
echo.
call npx --yes wrangler@4 login
echo.
echo  Xong. Gio bam dup file 2-DANG-WEB.bat
pause
