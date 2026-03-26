@echo off
echo.
echo  MIPI POWER HOUSE — Deploy to Vercel
echo  =====================================
cd /d "%~dp0"
echo  Pulling latest changes...
git pull
echo.
echo  Staging all changes...
git add .
echo.
set /p msg="Commit message (press Enter for 'update'): "
if "%msg%"=="" set msg=update
git commit -m "%msg%"
echo.
echo  Pushing to GitHub (Vercel auto-deploys)...
git push
echo.
echo  Done! Vercel will deploy in ~60 seconds.
echo  Check: https://vercel.com/dashboard
pause
