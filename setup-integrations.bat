@echo off
chcp 65001 >nul
title Vision Skills Integration Setup
setlocal enabledelayedexpansion

:: ============================================================
::  Vision Skills - Interactive Setup Menu
::  Ho tro tich hop vision cho AI tools khong doc duoc anh
:: ============================================================

set VERSION=1.0

:MENU
cls
echo ============================================
echo    Vision Skills v%VERSION% - Setup Integrations
echo    Bien AI text-only thanh AI biet nhin anh
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
echo  [A]  Tat ca cac nen tang tren
echo  [B]  Chi cai global CLI + Gemini key
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
if /i "%choice%"=="B" goto SETUP_GLOBALONLY
goto MENU

:SETUP_OPENCODE
cls
echo.
echo --- OpenCode Integration ---
echo.
set ODIR=%USERPROFILE%\.config\opencode\skills\vision-skills
if not exist "%ODIR%" mkdir "%ODIR%"
if exist ".\SKILL.md" (
    copy /Y ".\SKILL.md" "%ODIR%\SKILL.md" >nul
    echo  + SKILL.md copied
) else ( echo  ! SKILL.md not found )
echo.
echo  Them vao opencode.json:
echo.
echo  +---------------------------------------------+
echo  |  "mcp": {                                    |
echo  |    "vision-skills": {                        |
echo  |      "type": "local",                        |
echo  |      "command": ["npx", "vision-skills-mcp"] |
echo  |    }                                         |
echo  |  }                                           |
echo  +---------------------------------------------+
echo.
pause
goto MENU

:SETUP_CLAUDE
cls
echo.
echo --- Claude Code CLI Integration ---
echo.
set CLCFG=%USERPROFILE%\.claude\claude.json
if not exist "%USERPROFILE%\.claude" mkdir "%USERPROFILE%\.claude"
if not exist "%CLCFG%" echo {} > "%CLCFG%"
echo.
echo  Them vao claude.json:
echo.
echo  +---------------------------------------------+
echo  |  "mcpServers": {                             |
echo  |    "vision-skills": {                        |
echo  |      "command": "npx",                       |
echo  |      "args": ["vision-skills-mcp"]           |
echo  |    }                                         |
echo  |  }                                           |
echo  +---------------------------------------------+
echo.
pause
goto MENU

:SETUP_CODEX
cls
echo.
echo --- OpenAI Codex CLI Integration ---
echo.
echo  Them vao ~/.codex/config.json:
echo.
echo  +---------------------------------------------+
echo  |  "mcpServers": {                             |
echo  |    "vision-skills": {                        |
echo  |      "command": "npx",                       |
echo  |      "args": ["vision-skills-mcp"]           |
echo  |    }                                         |
echo  |  }                                           |
echo  +---------------------------------------------+
echo.
pause
goto MENU

:SETUP_CURSOR
cls
echo.
echo --- Cursor Integration ---
echo.
echo  Them vao .cursor/mcp.json:
echo.
echo  +---------------------------------------------+
echo  |  "mcpServers": {                             |
echo  |    "vision-skills": {                        |
echo  |      "command": "npx",                       |
echo  |      "args": ["vision-skills-mcp"]           |
echo  |    }                                         |
echo  |  }                                           |
echo  +---------------------------------------------+
echo.
pause
goto MENU

:SETUP_CONTINUE
cls
echo.
echo --- Continue (Continue.dev) Integration ---
echo.
echo  Them vao .continue/config.json:
echo.
echo  +---------------------------------------------+
echo  |  "experimental": {                           |
echo  |    "mcpServers": {                           |
echo  |      "vision-skills": {                      |
echo  |        "command": "npx",                    |
echo  |        "args": ["vision-skills-mcp"]        |
echo  |      }                                      |
echo  |    }                                        |
echo  |  }                                          |
echo  +---------------------------------------------+
echo.
pause
goto MENU

:SETUP_COPILOT
cls
echo.
echo --- GitHub Copilot Integration ---
echo.
echo  Them vao ~/.github/copilot.json:
echo.
echo  +---------------------------------------------+
echo  |  "mcpServers": {                             |
echo  |    "vision-skills": {                        |
echo  |      "command": "npx",                       |
echo  |      "args": ["vision-skills-mcp"]           |
echo  |    }                                         |
echo  |  }                                           |
echo  +---------------------------------------------+
echo.
echo  Luu y: Copilot MCP dang trong qua trinh ra mat.
echo.
pause
goto MENU

:SETUP_VSCODE
cls
echo.
echo --- VS Code Integration ---
echo.
echo  VS Code ho tro MCP tu phien ban moi nhat.
echo  File: .vscode/mcp.json (trong project hoac global)
echo.
echo  +---------------------------------------------+
echo  |  "servers": {                                |
echo  |    "vision-skills": {                        |
echo  |      "type": "stdio",                        |
echo  |      "command": "npx",                       |
echo  |      "args": ["vision-skills-mcp"]           |
echo  |    }                                         |
echo  |  }                                           |
echo  +---------------------------------------------+
echo.
pause
goto MENU

:SETUP_CLINE
cls
echo.
echo --- Cline / Roo / Kilo Code Integration ---
echo.
echo  Ca 3 deu ho tro MCP. Them vao:
echo.
echo  Cline: .cline/mcp.json
echo  Roo:   .roo/mcp.json
echo  Kilo:  .kilocode/mcp.json
echo.
echo  +---------------------------------------------+
echo  |  "mcpServers": {                             |
echo  |    "vision-skills": {                        |
echo  |      "command": "npx",                       |
echo  |      "args": ["vision-skills-mcp"]           |
echo  |    }                                         |
echo  |  }                                           |
echo  +---------------------------------------------+
echo.
pause
goto MENU

:SETUP_9ROUTER
cls
echo.
echo --- 9Router Integration ---
echo.
echo  Cach 1: Node.js app
echo    npm install vision-skills
echo    import { VisionSkills } from 'vision-skills'
echo.
echo  Cach 2: REST API
echo    npx vision-skills serve
echo    POST http://localhost:8000/v1/analyze
echo.
echo  Cach 3: CLI
echo    npx vision-skills analyze ./anh.png
echo.
pause
goto MENU

:SETUP_ALL
cls
echo.
echo --- Setup All Integrations ---
echo.
echo  Dang cai dat global vision-skills...
call npm install -g vision-skills 2>&1 | findstr /v "npm WARN"
echo  + Da cai dat global.
echo.
echo  Copy SKILL.md cho OpenCode...
set ODIR=%USERPROFILE%\.config\opencode\skills\vision-skills
if not exist "%ODIR%" mkdir "%ODIR%"
if exist ".\SKILL.md" copy /Y ".\SKILL.md" "%ODIR%\SKILL.md" >nul && echo  + Done
echo.
echo  Da tao config cho OpenCode, Claude Code, Cursor.
echo  + Sua file de them GEMINI_API_KEYS cua ban.
echo  + Khoi dong lai AI tool de nhan thay doi.
echo.
pause
goto MENU

:SETUP_GLOBALONLY
cls
echo.
echo --- Install Global CLI ---
echo.
call npm install -g vision-skills 2>&1 | findstr /v "npm WARN"
echo.
echo  + Da cai dat global.
echo.
echo  Kiem tra: vision-skills analyze ./anh.jpg
echo  Dat key:  set GEMINI_API_KEYS=AIzaSy...
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
