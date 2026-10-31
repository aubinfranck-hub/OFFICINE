@echo off
chcp 65001 >nul
title Mise a jour LGO
cd /d "%~dp0"
echo.
echo  Mise a jour du logiciel depuis GitHub (necessite internet)...
echo  Tes donnees (lgo.db) et ta configuration ne sont pas touchees.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $z=Join-Path $env:TEMP 'lgo-maj.zip'; $d=Join-Path $env:TEMP 'lgo-maj'; Invoke-WebRequest 'https://github.com/aubinfranck-hub/OFFICINE/archive/refs/heads/main.zip' -OutFile $z -UseBasicParsing; if (Test-Path $d) { Remove-Item $d -Recurse -Force }; Expand-Archive $z $d -Force; $src=(Get-ChildItem $d | Select-Object -First 1).FullName; Copy-Item (Join-Path $src 'server') . -Recurse -Force; Copy-Item (Join-Path $src 'public') . -Recurse -Force; Copy-Item (Join-Path $src 'package.json') . -Force; Copy-Item (Join-Path $src 'Demarrer-LGO.bat') 'Demarrer-LGO.nouveau.bat' -Force; Write-Host '  Mise a jour terminee.' -ForegroundColor Green } catch { Write-Host ('  Echec : ' + $_.Exception.Message) -ForegroundColor Red }"
echo.
echo  Redemarre LGO (ferme la fenetre noire puis relance Demarrer-LGO.bat) pour utiliser la nouvelle version.
pause
