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
echo  === Buoc 2: Dang web len Cloudflare ===
echo.
call npx --yes wrangler@4 deploy
if errorlevel 1 (
  echo.
  echo  [!] Dang web KHONG thanh cong. Chup man hinh cua so nay gui cho Claude.
  pause
  exit /b 1
)
echo.
echo  Xong! Dang mo trang overlay mau de kiem tra...
start "" "https://quantro.hoisoidaoly.workers.dev/overlay?room=TEST&test=1"
pause
