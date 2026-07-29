@echo off
chcp 65001 >nul
title Vision Skills Integration Setup
setlocal enabledelayedexpansion

:: ============================================================
::  Vision Skills - Interactive Setup Menu
::  Ho tro tich hop vision cho AI tools khong doc duoc anh
:: ============================================================

set VERSION=1.0

:GETKEY
cls
echo ============================================
echo    Vision Skills v%VERSION% - Setup Integrations
echo    Bien AI text-only thanh AI biet nhin anh
echo ============================================
echo.
echo  Ban can 1 Gemini API key (free, khong can the tin dung)
echo  Lay key tai: https://aistudio.google.com/apikey
echo.
set /p GEMINI_KEY="Nhap Gemini API key cua ban: "

if "%GEMINI_KEY%"=="" (
    echo.
    echo  [!] Vui long nhap key de tiep tuc.
    echo  Neu khong co key, lay mien phi tai:
    echo  https://aistudio.google.com/apikey
    echo.
    pause
    goto GETKEY
)

:: Kiem tra so bo - key Gemini bat dau bang AIza
if not "%GEMINI_KEY:~0,4%"=="AIza" (
    echo.
    echo  [!] Key khong hop le. Key Gemini thuong bat dau bang AIza...
    echo.
    pause
    goto GETKEY
)

:: Cai dat global
cls
echo.
echo  Dang cai dat vision-skills global (co the mat vai giay)...
call npm install -g vision-skills 2>&1 | findstr /v "npm WARN"
echo  + Da cai dat.

:MENU
cls
echo ============================================
echo    Vision Skills v%VERSION%
echo    Key: %GEMINI_KEY:~0,12%... (da luu)
echo ============================================
echo.
echo  Chon nen tang can tich hop:
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
echo  [A]  Tat ca
echo  [B]  Chi cai global CLI + set env
echo.
echo  [0]  Thoat
echo.
set /p choice="Chon (0-9, A, B): "

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
    echo  + File exists. Them MCP thu cong vao %CFG%
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
    echo  + File exists. Them MCP thu cong.
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
    echo  + File exists. Them MCP thu cong.
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
    echo  + File exists. Them MCP thu cong.
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
echo  VS Code ho tro MCP. Them vao .vscode/mcp.json:
echo.
echo  +---------------------------------------+
echo  |  "servers": {                          |
echo  |    "vision-skills": {                  |
echo  |      "type": "stdio",                  |
echo  |      "command": "npx",                 |
echo  |      "args": ["vision-skills-mcp"]     |
echo  |    }                                   |
echo  |  }                                     |
echo  +---------------------------------------+
echo  (VS Code doc bien mo truong GEMINI_API_KEYS tu he thong)
echo.
pause
goto MENU

:SETUP_CLINE
cls
echo.
echo --- Cline / Roo / Kilo Code ---
echo  Them vao file .cline/mcp.json, .roo/mcp.json, .kilocode/mcp.json:
echo.
echo  +---------------------------------------+
echo  |  "mcpServers": {                       |
echo  |    "vision-skills": {                  |
echo  |      "command": "npx",                 |
echo  |      "args": ["vision-skills-mcp"]     |
echo  |    }                                   |
echo  |  }                                     |
echo  +---------------------------------------+
echo  (Cac tool nay doc key tu GEMINI_API_KEYS env)
echo.
pause
goto MENU

:SETUP_9ROUTER
cls
echo.
echo --- 9Router ---
echo  Node.js:
echo    npm install vision-skills
echo    import { VisionSkills } from 'vision-skills'
echo    const vision = new VisionSkills({
echo      geminiApiKeys: ["%GEMINI_KEY:~0,12%..."]
echo    });
echo.
echo  REST API:
echo    npx vision-skills serve
echo    POST http://localhost:8000/v1/analyze
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
echo.
echo  + Da cau hinh xong cho OpenCode, Claude Code, Cursor!
echo  + Key cua ban da duoc dien tu dong vao cac file.
echo  + Khoi dong lai AI tool de nhan thay doi.
echo.
pause
goto MENU

:SETUP_ENV
cls
echo.
echo --- Set Env + CLI ---
echo  Dat GEMINI_API_KEYS vao he thong...
setx GEMINI_API_KEYS "%GEMINI_KEY%" >nul
echo  + Da luu vao Environment Variables.
echo  + Mo terminal MOI de nhan thay doi.
echo.
echo  Kiem tra: vision-skills analyze ./anh.jpg
echo.
pause
goto MENU

:EOF
cls
echo.
echo  Cam on ban da su dung Vision Skills!
echo  https://github.com/deepcode-ai-sys/vision-skills
echo.
pause
exit /b 0
