@echo off
chcp 65001 >nul
title Vision Skills Integration Setup
setlocal enabledelayedexpansion

:: ============================================================
::  Vision Skills - Interactive Setup Menu
::  Give text-only AI tools the ability to see and understand images
:: ============================================================

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
    echo.
    echo  [!] Key cannot be empty. Please enter a valid key.
    echo  Get a free key: https://aistudio.google.com/apikey
    echo.
    pause
    goto GETKEY
)

:: Basic validation - Gemini keys start with AIza
if not "%GEMINI_KEY:~0,4%"=="AIza" (
    echo.
    echo  [!] Invalid key format. Gemini keys typically start with 'AIza...'
    echo  Get a free key: https://aistudio.google.com/apikey
    echo.
    pause
    goto GETKEY
)

:: Install global
cls
echo.
echo  Installing vision-skills globally...
call npm install -g vision-skills 2>&1 | findstr /v "npm WARN"
echo  + Installed.

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
echo  [5]  Continue (Continue.dev)
echo  [6]  GitHub Copilot
echo  [7]  VS Code
echo  [8]  Cline / Roo / Kilo Code
echo  [9]  9Router
echo.
echo  [A]  All
echo  [B]  CLI only + set env
echo.
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

:MAKE_JSON <file> <content>
if not exist "%~dp1" mkdir "%~dp1"
echo %~2 > "%~1"
echo  + Created %~1
exit /b 0

:SETUP_OPENCODE
cls
echo.
echo --- OpenCode Integration ---
set ODIR=%USERPROFILE%\.config\opencode\skills\vision-skills
if not exist "%ODIR%" mkdir "%ODIR%"
if exist ".\SKILL.md" (
    copy /Y ".\SKILL.md" "%ODIR%\SKILL.md" >nul
    echo  + SKILL.md copied
)
set CFG=%USERPROFILE%\.config\opencode\opencode.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcp\": { \"vision-skills\": { \"type\": \"local\", \"command\": [\"npx\", \"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
) else (
    echo  + File exists. Them MCP config thu cong.
)
echo  + Done!
pause
goto MENU

:SETUP_CLAUDE
cls
echo.
echo --- Claude Code CLI ---
set CFG=%USERPROFILE%\.claude\claude.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
) else (
    echo  + File exists. Add MCP manually vao %CFG%
)
echo  + Done!
pause
goto MENU

:SETUP_CODEX
cls
echo.
echo --- OpenAI Codex CLI ---
set CFG=%USERPROFILE%\.codex\config.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
) else (
    echo  + File exists. Add MCP manually.
)
echo  + Done!
pause
goto MENU

:SETUP_CURSOR
cls
echo.
echo --- Cursor ---
set CFG=%USERPROFILE%\.cursor\mcp.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
) else (
    echo  + File exists. Add MCP manually.
)
echo  + Done!
pause
goto MENU

:SETUP_CONTINUE
cls
echo.
echo --- Continue (Continue.dev) ---
set CFG=%USERPROFILE%\.continue\config.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"experimental\": { \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } } }"
) else (
    echo  + File exists. Add MCP manually.
)
echo  + Done!
pause
goto MENU

:SETUP_COPILOT
cls
echo.
echo --- GitHub Copilot ---
set CFG=%USERPROFILE%\.github\copilot.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
) else (
    echo  + File exists.
)
echo  + Done!
pause
goto MENU

:SETUP_VSCODE
cls
echo.
echo --- VS Code ---
set CFG=.vscode\mcp.json
if not exist ".vscode" mkdir ".vscode"
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"servers\": { \"vision-skills\": { \"type\": \"stdio\", \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"] } } }"
    echo  + VS Code reads GEMINI_API_KEYS from environment variables.
) else (
    echo  + File exists. Add MCP manually.
)
echo  + Done!
pause
goto MENU

:SETUP_CLINE
cls
echo.
echo --- Cline / Roo / Kilo Code ---
echo.
echo  Creating .cline/mcp.json...
if not exist ".cline" mkdir ".cline"
set CFG=.cline\mcp.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
) else (
    echo  + File exists. Add MCP manually.
)
echo.
echo  For Roo, copy to .roo/mcp.json
echo  For Kilo Code, copy to .kilocode/mcp.json
echo  + Done!
pause
goto MENU

:SETUP_9ROUTER
cls
echo.
echo --- 9Router ---
echo.
echo  To integrate with 9Router, add this to your project:
echo.
echo  npm install vision-skills
echo.
echo  import { VisionSkills } from 'vision-skills'
echo  const vision = new VisionSkills({ geminiApiKeys: ["%GEMINI_KEY:~0,12%..."] })
echo  const result = await vision.analyze(screenshotBuffer)
echo.
echo  Or use the REST server:
echo  npx vision-skills serve
echo  POST http://localhost:8000/v1/analyze
echo.
pause
goto MENU

:SETUP_ALL
cls
echo.
echo --- Setup Tat Ca ---
:: OpenCode
set ODIR=%USERPROFILE%\.config\opencode\skills\vision-skills
if not exist "%ODIR%" mkdir "%ODIR%"
if exist ".\SKILL.md" copy /Y ".\SKILL.md" "%ODIR%\SKILL.md" >nul
set CFG=%USERPROFILE%\.config\opencode\opencode.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcp\": { \"vision-skills\": { \"type\": \"local\", \"command\": [\"npx\", \"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
)
:: Claude Code
set CFG=%USERPROFILE%\.claude\claude.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
)
:: Cursor
set CFG=%USERPROFILE%\.cursor\mcp.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
)
:: VS Code
if not exist ".vscode" mkdir ".vscode"
set CFG=.vscode\mcp.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"servers\": { \"vision-skills\": { \"type\": \"stdio\", \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"] } } }"
)
:: Cline
if not exist ".cline" mkdir ".cline"
set CFG=.cline\mcp.json
if not exist "%CFG%" (
    call :MAKE_JSON "%CFG%" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"%GEMINI_KEY%\" } } } }"
)
echo.
echo  + Configured OpenCode, Claude Code, Cursor, VS Code, Cline!
echo  + Your API key has been auto-filled.
echo  + Restart your AI tools to apply.
echo.
pause
goto MENU

:SETUP_ENV
cls
echo.
echo --- Set Env + CLI ---
echo  Saving GEMINI_API_KEYS to system environment...
setx GEMINI_API_KEYS "%GEMINI_KEY%" >nul
echo  + Saved to Environment Variables.
echo  + Open a NEW terminal to apply.
echo.
echo  Test it: vision-skills analyze ./image.jpg
echo.
pause
goto MENU

:EOF
cls
echo.
echo  Thank you for using Vision Skills!
echo  https://github.com/deepcode-ai-sys/vision-skills
echo.
pause
exit /b 0
