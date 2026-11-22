@echo off
REM ===================================================================
REM AgentForge Permanent Windows Startup Service Installer
REM Ensures AgentForge Manager runs automatically on PC reboot & power-on
REM ===================================================================

set AGENTFORGE_DIR=%~dp0..
cd /d "%AGENTFORGE_DIR%"

echo [1/3] Building latest AgentForge distribution...
call npm run build

echo [2/3] Registering Silent Background Daemon in Windows Startup...
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set DAEMON_VBS=%STARTUP_FOLDER%\AgentForgeManagerDaemon.vbs

(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.CurrentDirectory = "%AGENTFORGE_DIR%"
echo WshShell.Run "node dist/manager/serve.js", 0, False
) > "%DAEMON_VBS%"

echo [3/3] Testing AgentForge Manager Daemon...
cscript //nologo "%DAEMON_VBS%"

echo ===================================================================
echo [SUCCESS] AgentForge Permanent Startup Service Installed!
echo - AgentForge Manager will automatically launch on Windows reboot.
echo - Daemon location: %DAEMON_VBS%
echo - Dashboard active at: http://localhost:9470
echo ===================================================================
pause
