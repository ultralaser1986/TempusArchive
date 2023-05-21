@echo off
cd "%~dp0" && cd ".."
title TempusArchive UPLOAD

:loop
node . upload %*

echo. && echo Done! Restarting...
timeout 60
goto loop