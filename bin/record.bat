@echo off
cd "%~dp0" && cd ".."
title TempusArchive RECORD

:loop
node . record %*

:restart
IF EXIST "STATE" ( 
	echo. && echo Program terminated unexpectedly. Restarting...
	timeout 10
	node . record -c
	goto restart
)

echo. && echo Done! Restarting...
timeout 60
goto loop