@echo off
title TempusArchive

node bin/tempusarchive run %*

:restart
IF EXIST "STATE" ( 
	echo. && echo Program terminated unexpectedly. Restarting in 10s...
	timeout 10 > NUL
	node bin/tempusarchive run -c
	goto restart
)
