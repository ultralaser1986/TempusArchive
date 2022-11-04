@echo off
title TempusArchive

node bin/tempusarchive run %*

:restart
IF EXIST "STATE" ( 
	echo. && echo Program terminated unexpectedly. Restarting...
	node bin/tempusarchive run -c
	goto restart
)
