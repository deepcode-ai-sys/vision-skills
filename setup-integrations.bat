@echo off
chcp 65001 >nul
title Vision Skills Integration Setup
setlocal enabledelayedexpansion

:: ============================================================
::  Vision Skills - Interactive Setup Menu
::  Hỗ trợ tích hợp vision cho AI tools không đọc được ảnh
:: ============================================================

set VERSION=1.0
set GEMINI_ENV=GEMINI_API_KEYS

:MENU
cls
echo ============================================
echo    Vision Skills v%VERSION% - Setup Integrations
echo    Biến AI text-only thành AI biết nhìn ảnh
echo ============================================
echo.
echo  Chọn nền tảng cần tích hợp:
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
echo  [A]  Tất cả các nền tảng trên
echo  [B]  Chỉ cài global CLI + Gemini key
echo.
echo  [0]  Thoát
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

:: ============================================================
::  SETUP: OpenCode
:: ============================================================
:SETUP_OPENCODE
cls
echo.
echo --- OpenCode Integration ---
echo.
set OCFG=%USERPROFILE%\.config\opencode\opencode.json
set ODIR=%USERPROFILE%\.config\opencode\skills\vision-skills

:: Copy SKILL.md
if not exist "%ODIR%" mkdir "%ODIR%"
if exist ".\SKILL.md" (
    copy /Y ".\SKILL.md" "%ODIR%\SKILL.md" >nul
    echo  ✓ SKILL.md copied
) else (
    echo  [!] SKILL.md not found
)

:: Check existing opencode.json
if exist "%OCFG%" (
    echo  ✓ opencode.json exists
    echo  → Please add this section to your opencode.json:
) else (
    mkdir "%USERPROFILE%\.config\opencode" 2>nul
    type nul > "%OCFG%"
    echo  ✗ File created at %OCFG%
    echo  → Open it and paste the config below:
)

echo.
echo  ┌─────────────────────────────────────────────────────┐
echo  │  "mcp": {                                           │
echo  │    "vision-skills": {                                │
echo  │      "type": "local",                               │
echo  │      "command": ["npx", "vision-skills-mcp"],       │
echo  │      "env": { "GEMINI_API_KEYS": "AIzaSy..." }     │
echo  │    }                                                │
echo  │  }                                                  │
echo  └─────────────────────────────────────────────────────┘
echo.
echo  Sau đó restart OpenCode. AI sẽ tự biết gọi analyze().
echo.
pause
goto MENU

:: ============================================================
::  SETUP: Claude Code CLI
:: ============================================================
:SETUP_CLAUDE
cls
echo.
echo --- Claude Code CLI Integration ---
echo.
set CLDIR=%USERPROFILE%\.claude
set CLCFG=%CLDIR%\claude.json

if not exist "%CLDIR%" mkdir "%CLDIR%"

if exist "%CLCFG%" (
    echo  ✓ claude.json exists
) else (
    echo  {} > "%CLCFG%"
    echo  ✗ Created %CLCFG%
)

echo  → Add this to the file:
echo.
echo  ┌─────────────────────────────────────────────────────┐
echo  │  "mcpServers": {                                    │
echo  │    "vision-skills": {                                │
echo  │      "command": "npx",                              │
echo  │      "args": ["vision-skills-mcp"],                  │
echo  │      "env": { "GEMINI_API_KEYS": "AIzaSy..." }     │
echo  │    }                                                │
echo  │  }                                                  │
echo  └─────────────────────────────────────────────────────┘
echo.
pause
goto MENU

:: ============================================================
::  SETUP: OpenAI Codex CLI
:: ============================================================
:SETUP_CODEX
cls
echo.
echo --- OpenAI Codex CLI Integration ---
echo.
echo  Codex CLI supports the MCP standard.
echo.
echo  Config file: ~/.codex/config.json
echo.
echo  ┌──────────────────────────────────────────────────────┐
echo  │  "mcpServers": {                                      │
echo  │    "vision-skills": {                                 │
echo  │      "command": "npx",                                │
echo  │      "args": ["vision-skills-mcp"],                   │
echo  │      "env": { "GEMINI_API_KEYS": "AIzaSy..." }      │
echo  │    }                                                  │
echo  │  }                                                    │
echo  └──────────────────────────────────────────────────────┘
echo.
pause
goto MENU

:: ============================================================
::  SETUP: Cursor
:: ============================================================
:SETUP_CURSOR
cls
echo.
echo --- Cursor Integration ---
echo.
set CRDIR=%USERPROFILE%\.cursor
set CRCFG=%CRDIR%\mcp.json

if not exist "%CRDIR%" mkdir "%CRDIR%"

echo  Cursor supports MCP via .cursor/mcp.json
echo.
if exist "%CRCFG%" (
    echo  ✓ mcp.json exists
) else (
    echo  {} > "%CRCFG%"
    echo  ✗ Created %CRCFG%
)

echo  → Add this:
echo.
echo  ┌─────────────────────────────────────────────────────┐
echo  │  "mcpServers": {                                    │
echo  │    "vision-skills": {                                │
echo  │      "command": "npx",                              │
echo  │      "args": ["vision-skills-mcp"],                  │
echo  │      "env": { "GEMINI_API_KEYS": "AIzaSy..." }     │
echo  │    }                                                │
echo  │  }                                                  │
echo  └─────────────────────────────────────────────────────┘
echo.
pause
goto MENU

:: ============================================================
::  SETUP: Continue
:: ============================================================
:SETUP_CONTINUE
cls
echo.
echo --- Continue (Continue.dev) Integration ---
echo.
set CNDIR=%USERPROFILE%\.continue
set CNCFG=%CNDIR%\config.json

if not exist "%CNDIR%" mkdir "%CNDIR%"

if exist "%CNCFG%" (
    echo  ✓ config.json exists
) else (
    echo  {} > "%CNCFG%"
    echo  ✗ Created %CNCFG%
)

echo  Continue uses experimental MCP support in config.json:
echo.
echo  ┌─────────────────────────────────────────────────────┐
echo  │  "experimental": {                                   │
echo  │    "mcpServers": {                                   │
echo  │      "vision-skills": {                              │
echo  │        "command": "npx",                            │
echo  │        "args": ["vision-skills-mcp"],               │
echo  │        "env": { "GEMINI_API_KEYS": "AIzaSy..." }   │
echo  │      }                                              │
echo  │    }                                                │
echo  │  }                                                  │
echo  └─────────────────────────────────────────────────────┘
echo.
pause
goto MENU

:: ============================================================
::  SETUP: GitHub Copilot
:: ============================================================
:SETUP_COPILOT
cls
echo.
echo --- GitHub Copilot Integration ---
echo.
echo  GitHub Copilot supports MCP via:
echo  ~/.github/copilot.json
echo.
echo  ┌──────────────────────────────────────────────────────┐
echo  │  "mcpServers": {                                      │
echo  │    "vision-skills": {                                 │
echo  │      "command": "npx",                                │
echo  │      "args": ["vision-skills-mcp"],                   │
echo  │      "env": { "GEMINI_API_KEYS": "AIzaSy..." }      │
echo  │    }                                                  │
echo  │  }                                                    │
echo  └──────────────────────────────────────────────────────┘
echo.
echo  Note: Copilot MCP support is rolling out gradually.
echo.
pause
goto MENU

:: ============================================================
::  SETUP: VS Code
:: ============================================================
:SETUP_VSCODE
cls
echo.
echo --- VS Code Integration ---
echo.
echo  VS Code supports MCP natively (since recent updates).
echo.
echo  File: %USERPROFILE%\.vscode\mcp.json
echo  (or .vscode/mcp.json in your project)
echo.
echo  ┌──────────────────────────────────────────────────────┐
echo  │  "servers": {                                         │
echo  │    "vision-skills": {                                 │
echo  │      "type": "stdio",                                │
echo  │      "command": "npx",                               │
echo  │      "args": ["vision-skills-mcp"]                   │
echo  │    }                                                  │
echo  │  }                                                    │
echo  └──────────────────────────────────────────────────────┘
echo.
echo  Alternatively, use the CLI directly:
echo    npx vision-skills analyze ./image.jpg
echo.
pause
goto MENU

:: ============================================================
::  SETUP: Cline / Roo / Kilo Code (VS Code extensions)
:: ============================================================
:SETUP_CLINE
cls
echo.
echo --- Cline / Roo / Kilo Code Integration ---
echo.
echo  Cac extension VS Code nay deu ho tro MCP.
echo  Config file: .cline/mcp.json (or .vscode/mcp.json)
echo.
echo  ┌──────────────────────────────────────────────────────┐
echo  │  "mcpServers": {                                      │
echo  │    "vision-skills": {                                 │
echo  │      "command": "npx",                               │
echo  │      "args": ["vision-skills-mcp"],                   │
echo  │      "env": { "GEMINI_API_KEYS": "AIzaSy..." }      │
echo  │    }                                                  │
echo  │  }                                                    │
echo  └──────────────────────────────────────────────────────┘
echo.
echo  For Roo: .roo/mcp.json
echo  For Kilo Code: .kilocode/mcp.json (or VS Code MCP)
echo.
pause
goto MENU

:: ============================================================
::  SETUP: 9Router
:: ============================================================
:SETUP_9ROUTER
cls
echo.
echo --- 9Router Integration ---
echo.
echo  Cach 1 - Node.js app (import truc tiep):
echo.
echo    npm install vision-skills
echo.
echo    import { VisionSkills } from 'vision-skills';
echo    const vision = new VisionSkills({ geminiApiKeys: [...] });
echo    const result = await vision.analyze(screenshotBuffer);
echo.
echo  Cach 2 - REST API (bat ky ngon ngu):
echo.
echo    npx vision-skills serve
echo    POST http://localhost:8000/v1/analyze
echo    Body: { "image": "base64...", "mode": "standard" }
echo.
echo  Cach 3 - CLI (terminal/script):
echo.
echo    npx vision-skills analyze ./screenshot.png
echo.
pause
goto MENU

:: ============================================================
::  SETUP: ALL
:: ============================================================
:SETUP_ALL
cls
echo.
echo --- Setup All Integrations ---
echo.
echo  Installing global vision-skills...
call npm install -g vision-skills 2>&1 | findstr /v "npm WARN"
echo  ✓ Installed globally
echo.
echo  Copying SKILL.md for OpenCode...
set ODIR=%USERPROFILE%\.config\opencode\skills\vision-skills
if not exist "%ODIR%" mkdir "%ODIR%"
if exist ".\SKILL.md" copy /Y ".\SKILL.md" "%ODIR%\SKILL.md" >nul 2>&1 && echo  ✓ Done
echo.
echo  Creating MCP config files...

:: OpenCode
set OCFG=%USERPROFILE%\.config\opencode\opencode.json
if not exist "%OCFG%" (
    mkdir "%USERPROFILE%\.config\opencode" 2>nul
    echo { "mcp": { "vision-skills": { "type": "local", "command": ["npx", "vision-skills-mcp"], "env": { "GEMINI_API_KEYS": "YOUR_KEY" } } } } > "%OCFG%"
    echo  ✓ Created OpenCode config
) else (
    echo  [i] OpenCode config exists - add MCP manually
)

:: Claude Code
set CLCFG=%USERPROFILE%\.claude\claude.json
if not exist "%CLCFG%" (
    mkdir "%USERPROFILE%\.claude" 2>nul
    echo { "mcpServers": { "vision-skills": { "command": "npx", "args": ["vision-skills-mcp"], "env": { "GEMINI_API_KEYS": "YOUR_KEY" } } } } > "%CLCFG%"
    echo  ✓ Created Claude Code config
) else (
    echo  [i] Claude Code config exists - add MCP manually
)

:: Cursor
set CRCFG=%USERPROFILE%\.cursor\mcp.json
if not exist "%CRCFG%" (
    mkdir "%USERPROFILE%\.cursor" 2>nul
    echo { "mcpServers": { "vision-skills": { "command": "npx", "args": ["vision-skills-mcp"], "env": { "GEMINI_API_KEYS": "YOUR_KEY" } } } } > "%CRCFG%"
    echo  ✓ Created Cursor MCP config
) else (
    echo  [i] Cursor config exists - add MCP manually
)

echo.
echo  ✓ All integrations configured!
echo  → Edit each config file to add your GEMINI_API_KEYS
echo  → Restart your AI tools
echo.
pause
goto MENU

:: ============================================================
::  SETUP: CLI + Gemini Key only
:: ============================================================
:SETUP_GLOBALONLY
cls
echo.
echo --- Install Global CLI ---
echo.
call npm install -g vision-skills 2>&1 | findstr /v "npm WARN"
echo.
echo  ✓ vision-skills installed globally
echo.
echo  Kiem tra bang cach chay:
echo    vision-skills analyze ./anh.jpg
echo.
echo  Dat bien moi truong GEMINI_API_KEYS:
echo    set GEMINI_API_KEYS=AIzaSy...
echo.
pause
goto MENU

:: ============================================================
:EOF
cls
echo.
echo  Cam on ban da su dung Vision Skills!
echo  https://github.com/deepcode-ai-sys/vision-skills
echo.
pause
exit /b 0
