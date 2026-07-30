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
if not "%GEMINI_KEY:~0,4%"=="AIza" (
    echo.
    echo  [!] Invalid key format. Gemini keys typically start with 'AIza...'
    echo  Get a free key: https://aistudio.google.com/apikey
    echo.
    pause
    goto GETKEY
)

:: Build local + link globally
cls
echo.
echo  Building from local source...
cd /d "%~dp0"
call npm install 2>nul
call npm run build 2>nul
call npm link 2>nul
echo  + Ready. vision-skills is now available globally.

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

:: PowerShell helper - create JSON file with MCP config
:MAKE_JSON <file> <json-label>
:: Builds the correct JSON using PowerShell to handle escaping properly
set CFG_PATH=%~1
set JSON_LABEL=%~2
goto :EOF

:: --- OpenCode ---
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
powershell -ExecutionPolicy Bypass -Command "
    $key = '%GEMINI_KEY%';
    $cfg = '%CFG%';
    $dir = Split-Path $cfg -Parent;
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (!(Test-Path $cfg)) {
        $mcp = @{ mcp = @{ 'vision-skills' = @{ type = 'local'; command = @('npx', 'vision-skills-mcp'); enabled = $true; env = @{ GEMINI_API_KEYS = $key } } } };
        $mcp | ConvertTo-Json -Depth 10 | Set-Content $cfg -Encoding UTF8;
        Write-Host '+ Config created';
    } else {
        $json = Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json;
        if ($json.mcp -eq $null) { $json | Add-Member -Name 'mcp' -Value @{} -MemberType NoteProperty }
        $json.mcp | Add-Member -Name 'vision-skills' -Value @{ type = 'local'; command = @('npx', 'vision-skills-mcp'); enabled = $true; env = @{ GEMINI_API_KEYS = $key } } -Force;
        $json | ConvertTo-Json -Depth 10 | Set-Content $cfg -Encoding UTF8;
        Write-Host '+ MCP config merged into existing file';
    }
"
echo  + Done! Restart OpenCode to apply.
pause
goto MENU

:: --- Claude Code CLI ---
:SETUP_CLAUDE
cls
echo.
echo --- Claude Code CLI ---
set CFG=%USERPROFILE%\.claude\claude.json
powershell -ExecutionPolicy Bypass -Command "
    $key = '%GEMINI_KEY%';
    $cfg = '%CFG%';
    $dir = Split-Path $cfg -Parent;
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (!(Test-Path $cfg)) {
        @{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = $key } } } } | ConvertTo-Json | Set-Content $cfg -Encoding UTF8;
        Write-Host '+ Config created';
    } else { Write-Host '+ File exists. Add MCP manually.' }
"
echo  + Done!
pause
goto MENU

:: --- OpenAI Codex CLI ---
:SETUP_CODEX
cls
echo.
echo --- OpenAI Codex CLI ---
set CFG=%USERPROFILE%\.codex\config.json
powershell -ExecutionPolicy Bypass -Command "
    $key = '%GEMINI_KEY%';
    $cfg = '%CFG%';
    $dir = Split-Path $cfg -Parent;
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (!(Test-Path $cfg)) {
        @{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = $key } } } } | ConvertTo-Json | Set-Content $cfg -Encoding UTF8;
        Write-Host '+ Config created';
    } else { Write-Host '+ File exists. Add MCP manually.' }
"
echo  + Done!
pause
goto MENU

:: --- Cursor ---
:SETUP_CURSOR
cls
echo.
echo --- Cursor ---
set CFG=%USERPROFILE%\.cursor\mcp.json
powershell -ExecutionPolicy Bypass -Command "
    $key = '%GEMINI_KEY%';
    $cfg = '%CFG%';
    $dir = Split-Path $cfg -Parent;
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (!(Test-Path $cfg)) {
        @{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = $key } } } } | ConvertTo-Json | Set-Content $cfg -Encoding UTF8;
        Write-Host '+ Config created';
    } else { Write-Host '+ File exists. Add MCP manually.' }
"
echo  + Done!
pause
goto MENU

:: --- Continue (Continue.dev) ---
:SETUP_CONTINUE
cls
echo.
echo --- Continue (Continue.dev) ---
set CFG=%USERPROFILE%\.continue\config.json
powershell -ExecutionPolicy Bypass -Command "
    $key = '%GEMINI_KEY%';
    $cfg = '%CFG%';
    $dir = Split-Path $cfg -Parent;
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (!(Test-Path $cfg)) {
        @{ experimental = @{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = $key } } } } } | ConvertTo-Json -Depth 10 | Set-Content $cfg -Encoding UTF8;
        Write-Host '+ Config created';
    } else { Write-Host '+ File exists. Add MCP manually.' }
"
echo  + Done!
pause
goto MENU

:: --- GitHub Copilot ---
:SETUP_COPILOT
cls
echo.
echo --- GitHub Copilot ---
set CFG=%USERPROFILE%\.github\copilot.json
powershell -ExecutionPolicy Bypass -Command "
    $key = '%GEMINI_KEY%';
    $cfg = '%CFG%';
    $dir = Split-Path $cfg -Parent;
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (!(Test-Path $cfg)) {
        @{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = $key } } } } | ConvertTo-Json | Set-Content $cfg -Encoding UTF8;
        Write-Host '+ Config created';
    } else { Write-Host '+ File exists.' }
"
echo  + Done!
pause
goto MENU

:: --- VS Code ---
:SETUP_VSCODE
cls
echo.
echo --- VS Code ---
set CFG=.vscode\mcp.json
if not exist ".vscode" mkdir ".vscode"
powershell -ExecutionPolicy Bypass -Command "
    $cfg = '.vscode\mcp.json';
    if (!(Test-Path $cfg)) {
        @{ servers = @{ 'vision-skills' = @{ type = 'stdio'; command = 'npx'; args = @('vision-skills-mcp') } } } | ConvertTo-Json -Depth 10 | Set-Content $cfg -Encoding UTF8;
        Write-Host '+ VS Code MCP config created';
    } else { Write-Host '+ File exists.' }
"
echo  + Done!
pause
goto MENU

:: --- Cline / Roo / Kilo Code ---
:SETUP_CLINE
cls
echo.
echo --- Cline / Roo / Kilo Code ---
set CFG=.cline\mcp.json
if not exist ".cline" mkdir ".cline"
powershell -ExecutionPolicy Bypass -Command "
    $key = '%GEMINI_KEY%';
    $cfg = '.cline\mcp.json';
    if (!(Test-Path $cfg)) {
        @{ mcpServers = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = $key } } } } | ConvertTo-Json -Depth 10 | Set-Content $cfg -Encoding UTF8;
        Write-Host '+ Cline MCP config created';
    } else { Write-Host '+ File exists.' }
"
echo  + Done!
pause
goto MENU

:: --- 9Router ---
:SETUP_9ROUTER
cls
echo.
echo --- 9Router ---
echo.
echo  Integrate via SDK or REST:
echo    npm install vision-skills
echo    const v = new VisionSkills({ geminiApiKeys: ["%GEMINI_KEY:~0,12%..."] })
echo    npx vision-skills serve
echo.
pause
goto MENU

:: --- All ---
:SETUP_ALL
cls
echo.
echo --- Setup All ---
set KEY=%GEMINI_KEY%
set ODIR=%USERPROFILE%\.config\opencode\skills\vision-skills
if not exist "%ODIR%" mkdir "%ODIR%"
if exist ".\SKILL.md" copy /Y ".\SKILL.md" "%ODIR%\SKILL.md" >nul

powershell -ExecutionPolicy Bypass -Command "
    $key = '%KEY%';
    $targets = @(
        @{ path = '%USERPROFILE%\.config\opencode\opencode.json'; mcp = @{ 'vision-skills' = @{ type = 'local'; command = @('npx', 'vision-skills-mcp'); enabled = $true; env = @{ GEMINI_API_KEYS = $key } } } };
        @{ path = '%USERPROFILE%\.claude\claude.json'; mcp = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = $key } } } };
        @{ path = '%USERPROFILE%\.cursor\mcp.json'; mcp = @{ 'vision-skills' = @{ command = 'npx'; args = @('vision-skills-mcp'); env = @{ GEMINI_API_KEYS = $key } } } }
    );
    foreach ($t in $targets) {
        $dir = Split-Path $t.path -Parent;
        if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        if (!(Test-Path $t.path)) {
            if ($t.path -match 'opencode') {
                @{ mcp = $t.mcp } | ConvertTo-Json -Depth 10 | Set-Content $t.path -Encoding UTF8;
            } else {
                @{ mcpServers = $t.mcp } | ConvertTo-Json -Depth 10 | Set-Content $t.path -Encoding UTF8;
            }
            Write-Host ('+ Created: ' + $t.path);
        } else {
            Write-Host ('+ Exists: ' + $t.path + ' - add MCP manually');
        }
    }
"
echo  + Done! Restart AI tools to apply.
pause
goto MENU

:: --- Set Env + CLI ---
:SETUP_ENV
cls
echo.
echo --- Set Env + CLI ---
echo  Saving GEMINI_API_KEYS to system environment...
setx GEMINI_API_KEYS "%GEMINI_KEY%" >nul
echo  + Saved to Environment Variables.
echo  + Open a NEW terminal to apply.
echo.
echo  Test: vision-skills analyze ./image.jpg
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
