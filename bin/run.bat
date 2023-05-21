@echo off
cd "%~dp0" && cd ".."
title TempusArchive RUN

node . run %*

:restart
IF EXIST "STATE" ( 
	echo. && echo Program terminated unexpectedly. Restarting...
	timeout 10
	node . run -c
	goto restart
)
