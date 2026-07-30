@echo off
chcp 65001 >nul
title Vision Skills Integration Setup
setlocal enabledelayedexpansion

set VERSION=1.0

:GETKEY
cls
echo ============================================
echo    Vision Skills v%VERSION% - Setup Integrations
echo    Give text-only AI models the ability to see images
echo ============================================
echo.
echo  You need a Gemini API key (free, no credit card required).
echo  Get one at: https://aistudio.google.com/apikey
echo.
set /p GEMINI_KEY="Enter your Gemini API key: "

if "%GEMINI_KEY%"=="" (
    echo [!] Key cannot be empty.
    pause
    goto GETKEY
)
if not "%GEMINI_KEY:~0,4%"=="AIza" (
    echo [!] Invalid key format. Gemini keys start with 'AIza...'
    pause
    goto GETKEY
)

:: Build
cls
echo.
echo  Building vision-skills from local source...
cd /d "%~dp0"
call npm install 2>nul
call npm run build 2>nul
echo  + Build complete.

:MENU
cls
echo ============================================
echo    Vision Skills v%VERSION%
echo    Key: %GEMINI_KEY:~0,12%... (saved)
echo ============================================
echo.
echo  Select platform to integrate:
echo.
echo  [1]  OpenCode
echo  [2]  Claude Code CLI
echo  [3]  OpenAI Codex CLI
echo  [4]  Cursor
echo  [5]  Continue
echo  [6]  GitHub Copilot
echo  [7]  VS Code
echo  [8]  Cline / Roo / Kilo Code
echo  [9]  9Router
echo  [A]  All
echo  [B]  Set env only
echo  [0]  Exit
echo.
set /p choice="Select (0-9, A, B): "

if "%choice%"=="0" goto EOF
if "%choice%"=="1" goto SETUP_OPENCODE
if "%choice%"=="2" goto SETUP_CLAUDE
if "%choice%"=="3" goto SETUP_CODEX
if "%choice%"=="4" goto SETUP_CURSOR
if "%choice%"=="5" goto SETUP_CONTINUE
if "%choice%"=="6" goto SETUP_COPILOT
if "%choice%"=="7" goto SETUP_VSCODE
if "%choice%"=="8" goto SETUP_CLINE
if "%choice%"=="9" goto SETUP_9ROUTER
if /i "%choice%"=="A" goto SETUP_ALL
if /i "%choice%"=="B" goto SETUP_ENV
goto MENU

:SETUP_OPENCODE
cls
echo.
echo --- OpenCode ---
:: Copy SKILL.md
set ODIR=%USERPROFILE%\.config\opencode\skills\vision-skills
if not exist "%ODIR%" mkdir "%ODIR%"
if exist ".\SKILL.md" copy /Y ".\SKILL.md" "%ODIR%\SKILL.md" >nul && echo + SKILL.md copied
:: Add MCP config via PowerShell script
set SERVER_PATH=%~dp0dist\mcp-server.js
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\add-mcp-config.ps1" -ConfigPath "%USERPROFILE%\.config\opencode\opencode.json" -ApiKey "%GEMINI_KEY%" -ServerPath "%SERVER_PATH%"
echo + Done. Restart OpenCode.
pause
goto MENU

:SETUP_CLAUDE
cls
echo.
echo --- Claude Code CLI ---
set CFG=%USERPROFILE%\.claude\claude.json
if not exist "%USERPROFILE%\.claude" mkdir "%USERPROFILE%\.claude"
if not exist "%CFG%" (
    powershell -Command "@{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = '%GEMINI_KEY%' } } } } | ConvertTo-Json -Depth 10 | Set-Content '%CFG%' -Encoding UTF8"
    echo + Config created
) else echo + File exists. Add MCP manually.
pause
goto MENU

:SETUP_CODEX
cls
echo.
echo --- OpenAI Codex CLI ---
set CFG=%USERPROFILE%\.codex\config.json
if not exist "%USERPROFILE%\.codex" mkdir "%USERPROFILE%\.codex"
if not exist "%CFG%" (
    powershell -Command "@{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = '%GEMINI_KEY%' } } } } | ConvertTo-Json -Depth 10 | Set-Content '%CFG%' -Encoding UTF8"
    echo + Config created
) else echo + File exists.
pause
goto MENU

:SETUP_CURSOR
cls
echo.
echo --- Cursor ---
set CFG=%USERPROFILE%\.cursor\mcp.json
if not exist "%USERPROFILE%\.cursor" mkdir "%USERPROFILE%\.cursor"
if not exist "%CFG%" (
    powershell -Command "@{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = '%GEMINI_KEY%' } } } } | ConvertTo-Json -Depth 10 | Set-Content '%CFG%' -Encoding UTF8"
    echo + Config created
) else echo + File exists.
pause
goto MENU

:SETUP_CONTINUE
cls
echo.
echo --- Continue ---
set CFG=%USERPROFILE%\.continue\config.json
if not exist "%USERPROFILE%\.continue" mkdir "%USERPROFILE%\.continue"
if not exist "%CFG%" (
    powershell -Command "@{ experimental = @{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = '%GEMINI_KEY%' } } } } } | ConvertTo-Json -Depth 10 | Set-Content '%CFG%' -Encoding UTF8"
    echo + Config created
) else echo + File exists.
pause
goto MENU

:SETUP_COPILOT
cls
echo.
echo --- GitHub Copilot ---
set CFG=%USERPROFILE%\.github\copilot.json
if not exist "%USERPROFILE%\.github" mkdir "%USERPROFILE%\.github"
if not exist "%CFG%" (
    powershell -Command "@{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = '%GEMINI_KEY%' } } } } | ConvertTo-Json -Depth 10 | Set-Content '%CFG%' -Encoding UTF8"
    echo + Config created
) else echo + File exists.
pause
goto MENU

:SETUP_VSCODE
cls
echo.
echo --- VS Code ---
if not exist ".vscode" mkdir ".vscode"
if not exist ".vscode\mcp.json" (
    powershell -Command "@{ servers = @{ 'vision-skills' = @{ type = 'stdio'; command = 'npx'; args = @('vision-skills-mcp') } } } | ConvertTo-Json -Depth 10 | Set-Content '.vscode\mcp.json' -Encoding UTF8"
    echo + VS Code MCP config created
) else echo + File exists.
pause
goto MENU

:SETUP_CLINE
cls
echo.
echo --- Cline / Roo / Kilo Code ---
if not exist ".cline" mkdir ".cline"
if not exist ".cline\mcp.json" (
    powershell -Command "@{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = '%GEMINI_KEY%' } } } } | ConvertTo-Json -Depth 10 | Set-Content '.cline\mcp.json' -Encoding UTF8"
    echo + Cline MCP config created
) else echo + File exists.
pause
goto MENU

:SETUP_9ROUTER
cls
echo.
echo --- 9Router ---
echo.
echo  npm install vision-skills
echo  const v = new VisionSkills({ geminiApiKeys: ["%GEMINI_KEY:~0,12%..."] })
echo  npx vision-skills serve
echo.
pause
goto MENU

:SETUP_ALL
cls
echo.
echo --- Setup All ---
set ODIR=%USERPROFILE%\.config\opencode\skills\vision-skills
if not exist "%ODIR%" mkdir "%ODIR%"
if exist ".\SKILL.md" copy /Y ".\SKILL.md" "%ODIR%\SKILL.md" >nul
:: OpenCode
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\add-mcp-config.ps1" -ConfigPath "%USERPROFILE%\.config\opencode\opencode.json" -ApiKey "%GEMINI_KEY%" -ServerPath "%~dp0dist\mcp-server.js"
:: Claude
if not exist "%USERPROFILE%\.claude" mkdir "%USERPROFILE%\.claude"
if not exist "%USERPROFILE%\.claude\claude.json" (
    powershell -Command "@{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = '%GEMINI_KEY%' } } } } | ConvertTo-Json -Depth 10 | Set-Content '%USERPROFILE%\.claude\claude.json' -Encoding UTF8"
)
:: Cursor
if not exist "%USERPROFILE%\.cursor" mkdir "%USERPROFILE%\.cursor"
if not exist "%USERPROFILE%\.cursor\mcp.json" (
    powershell -Command "@{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = '%GEMINI_KEY%' } } } } | ConvertTo-Json -Depth 10 | Set-Content '%USERPROFILE%\.cursor\mcp.json' -Encoding UTF8"
)
:: VS Code
if not exist ".vscode" mkdir ".vscode"
if not exist ".vscode\mcp.json" (
    powershell -Command "@{ servers = @{ 'vision-skills' = @{ type = 'stdio'; command = 'npx'; args = @('vision-skills-mcp') } } } | ConvertTo-Json -Depth 10 | Set-Content '.vscode\mcp.json' -Encoding UTF8"
)
echo + Done! Restart tools.
pause
goto MENU

:SETUP_ENV
cls
echo.
echo --- Set Env ---
setx GEMINI_API_KEYS "%GEMINI_KEY%" >nul
echo + Saved to env. Open new terminal.
echo + Test: vision-skills analyze ./image.jpg
pause
goto MENU

:EOF
exit /b 0
