@echo off
chcp 65001 >nul
title LGO Officine
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 ou plus est requis. Installe-le ici : https://nodejs.org
  start https://nodejs.org
  pause
  exit /b
)
set DB=%~dp0lgo.db
set PORT=3000
rem Les réglages propres à cette officine (adresse du site web, clé d'envoi) sont dans config-lgo.bat
if exist "%~dp0config-lgo.bat" call "%~dp0config-lgo.bat"
echo.
echo  LGO Officine. Sur ce PC : http://localhost:3000
echo  Sur les tablettes et telephones (meme WiFi) :
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     http://%%a:3000
echo.
echo  Ne ferme pas cette fenetre pendant que la pharmacie travaille.
echo  Si le serveur s'arrete, il redemarre tout seul (journal : lgo.log).
echo.
:boucle
echo [%date% %time%] demarrage >> lgo.log
node --no-warnings server\server.js >> lgo.log 2>&1
echo [%date% %time%] arret (code %errorlevel%) >> lgo.log
echo  Le serveur s'est arrete, redemarrage dans 3 secondes...
timeout /t 3 /nobreak >nul
goto boucle
