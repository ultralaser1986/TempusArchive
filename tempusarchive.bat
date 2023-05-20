@echo off
title TempusArchive

node . run %*

:restart
IF EXIST "STATE" ( 
	echo. && echo Program terminated unexpectedly. Restarting in 10s...
	timeout 10 > NUL
	node . run -c
	goto restart
)
