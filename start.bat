@echo off
powershell -Command "Start-Process powershell -ArgumentList '-NoExit -Command cd \"%~dp0\" ; npm start' -Verb RunAs"