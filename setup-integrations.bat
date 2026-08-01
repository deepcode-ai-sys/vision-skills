@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Vision Skills Integration Setup

set "VERSION=1.1"
set "SCRIPT_DIR=%~dp0"
set "MERGER=%~dp0scripts\add-json-mcp.mjs"

where node >nul 2>nul || (
  echo Error: Node.js is required. Install it from https://nodejs.org
  exit /b 1
)
where npx >nul 2>nul || (
  echo Error: npx is required. Reinstall Node.js from https://nodejs.org
  exit /b 1
)
if not exist "%MERGER%" (
  echo Error: missing setup helper: "%MERGER%"
  exit /b 1
)

:GET_KEY
cls
echo Vision Skills v%VERSION% integration setup
echo Get a free Gemini API key at https://aistudio.google.com/apikey
set "GEMINI_KEY="
set /p "GEMINI_KEY=Gemini API key: "
if errorlevel 1 exit /b 1
if not defined GEMINI_KEY goto INVALID_KEY
if /i not "%GEMINI_KEY:~0,4%"=="AIza" goto INVALID_KEY
goto MENU

:INVALID_KEY
echo Invalid key format. Gemini API keys normally start with AIza.
pause
goto GET_KEY

:MENU
cls
echo Vision Skills v%VERSION%
echo.
echo 1. OpenCode
echo 2. Claude Code
echo 3. OpenAI Codex CLI
echo 4. Cursor
echo 5. Continue
echo 6. VS Code / GitHub Copilot
echo 7. Cline
echo A. Configure all supported clients
echo B. Save key as a user environment variable
echo 0. Exit
echo.
set "CHOICE="
set /p "CHOICE=Select: "
if "%CHOICE%"=="1" goto OPENCODE
if "%CHOICE%"=="2" goto CLAUDE
if "%CHOICE%"=="3" goto CODEX
if "%CHOICE%"=="4" goto CURSOR
if "%CHOICE%"=="5" goto CONTINUE
if "%CHOICE%"=="6" goto VSCODE
if "%CHOICE%"=="7" goto CLINE
if /i "%CHOICE%"=="A" goto ALL
if /i "%CHOICE%"=="B" goto ENV
if "%CHOICE%"=="0" exit /b 0
goto MENU

:RUN_MERGER
set "VISION_SKILLS_SETUP_KEY=%GEMINI_KEY%"
node "%MERGER%" "%TARGET_CONFIG%" "%TARGET_FORMAT%"
set "MERGE_RESULT=%errorlevel%"
set "VISION_SKILLS_SETUP_KEY="
if not "%MERGE_RESULT%"=="0" goto FAILED
echo Restart the configured client to load the MCP server.
pause
goto MENU

:OPENCODE
set "SKILL_DIR=%USERPROFILE%\.config\opencode\skills\vision-skills"
if not exist "%SKILL_DIR%" mkdir "%SKILL_DIR%" || goto FAILED
copy /Y "%SCRIPT_DIR%SKILL.md" "%SKILL_DIR%\SKILL.md" >nul || goto FAILED
set "TARGET_CONFIG=%USERPROFILE%\.config\opencode\opencode.json"
set "TARGET_FORMAT=opencode"
goto RUN_MERGER

:CLAUDE
set "TARGET_CONFIG=%USERPROFILE%\.claude.json"
set "TARGET_FORMAT=standard"
goto RUN_MERGER

:CODEX
where codex >nul 2>nul || (
  echo Error: Codex CLI is not installed; its TOML config was not modified.
  pause
  goto MENU
)
call codex mcp add vision-skills --env "GEMINI_API_KEYS=%GEMINI_KEY%" -- npx -y --package vision-skills vision-skills-mcp
if errorlevel 1 (
  echo Codex may already contain vision-skills. Check with: codex mcp list
  pause
  goto MENU
)
echo Configured vision-skills through Codex CLI.
pause
goto MENU

:CURSOR
set "TARGET_CONFIG=%USERPROFILE%\.cursor\mcp.json"
set "TARGET_FORMAT=standard"
goto RUN_MERGER

:CONTINUE
set "TARGET_CONFIG=%CD%\.continue\mcpServers\vision-skills.json"
set "TARGET_FORMAT=continue"
goto RUN_MERGER

:VSCODE
set "TARGET_CONFIG=%CD%\.vscode\mcp.json"
set "TARGET_FORMAT=vscode"
goto RUN_MERGER

:CLINE
set "TARGET_CONFIG=%USERPROFILE%\.cline\mcp.json"
set "TARGET_FORMAT=standard"
goto RUN_MERGER

:ALL
call :CONFIGURE_ONE "%USERPROFILE%\.config\opencode\opencode.json" opencode
if errorlevel 1 goto FAILED
set "SKILL_DIR=%USERPROFILE%\.config\opencode\skills\vision-skills"
if not exist "%SKILL_DIR%" mkdir "%SKILL_DIR%" || goto FAILED
copy /Y "%SCRIPT_DIR%SKILL.md" "%SKILL_DIR%\SKILL.md" >nul || goto FAILED
call :CONFIGURE_ONE "%USERPROFILE%\.claude.json" standard
if errorlevel 1 goto FAILED
call :CONFIGURE_ONE "%USERPROFILE%\.cursor\mcp.json" standard
if errorlevel 1 goto FAILED
call :CONFIGURE_ONE "%CD%\.continue\mcpServers\vision-skills.json" continue
if errorlevel 1 goto FAILED
call :CONFIGURE_ONE "%CD%\.vscode\mcp.json" vscode
if errorlevel 1 goto FAILED
call :CONFIGURE_ONE "%USERPROFILE%\.cline\mcp.json" standard
if errorlevel 1 goto FAILED
echo Configured all JSON-based clients. Select Codex separately if installed.
pause
goto MENU

:CONFIGURE_ONE
set "VISION_SKILLS_SETUP_KEY=%GEMINI_KEY%"
node "%MERGER%" "%~1" "%~2"
set "MERGE_RESULT=%errorlevel%"
set "VISION_SKILLS_SETUP_KEY="
exit /b %MERGE_RESULT%

:ENV
setx GEMINI_API_KEYS "%GEMINI_KEY%" >nul
if errorlevel 1 goto FAILED
echo Saved GEMINI_API_KEYS for the current Windows user. Open a new terminal.
pause
goto MENU

:FAILED
echo Setup failed. Existing configuration was not intentionally overwritten.
pause
goto MENU
