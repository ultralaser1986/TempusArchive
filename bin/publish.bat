@echo off
cd "%~dp0" && cd ".."
title TempusArchive PUBLISH

:loop
node . publish %*

echo. && echo Done! Restarting...
timeout 600
goto loop