@echo off
chcp 65001 >nul
title Vision Skills - Setup Integrations
echo ============================================
echo  Vision Skills - Setup Integrations
echo ============================================
echo.

:: Check prerequisites
where npx >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

set SKILLS_DIR=%USERPROFILE%\.config\opencode\skills\vision-skills
set MCP_CONFIG=%USERPROFILE%\.config\opencode\opencode.json

echo [1/5] Creating SKILL.md for OpenCode...
if not exist "%SKILLS_DIR%" mkdir "%SKILLS_DIR%"
if exist ".\SKILL.md" (
    copy /Y ".\SKILL.md" "%SKILLS_DIR%\SKILL.md" >nul
    echo   ✓ SKILL.md copied to %SKILLS_DIR%
) else (
    echo   [!] SKILL.md not found in current directory
)

echo.
echo [2/5] OpenCode MCP configuration
if exist "%MCP_CONFIG%" (
    echo   ✓ opencode.json found at %MCP_CONFIG%
    echo   → Add this to your opencode.json manually:
    echo.
    echo   {
    echo     "mcp": {
    echo       "vision-skills": {
    echo         "type": "local",
    echo         "command": ["npx", "vision-skills-mcp"],
    echo         "env": { "GEMINI_API_KEYS": "YOUR_KEY_HERE" }
    echo       }
    echo     }
    echo   }
    echo.
) else (
    echo   Creating opencode.json with MCP config...
    (
        echo {
        echo   "mcp": {
        echo     "vision-skills": {
        echo       "type": "local",
        echo       "command": ["npx", "vision-skills-mcp"],
        echo       "env": { "GEMINI_API_KEYS": "YOUR_KEY_HERE" }
        echo     }
        echo   }
        echo }
    ) > "%MCP_CONFIG%"
    echo   ✓ Created %MCP_CONFIG%
    echo   → Edit the file and replace YOUR_KEY_HERE with your Gemini API key
)

echo.
echo [3/5] Claude Code CLI integration
set CLAUDE_CONFIG=%USERPROFILE%\.claude\claude.json
if exist "%CLAUDE_CONFIG%" (
    echo   ✓ Claude Code detected.
    echo   → Add this to %CLAUDE_CONFIG%:
    echo.
    echo   "mcpServers": {
    echo     "vision-skills": {
    echo       "command": "npx",
    echo       "args": ["vision-skills-mcp"],
    echo       "env": { "GEMINI_API_KEYS": "YOUR_KEY_HERE" }
    echo     }
    echo   }
    echo.
) else (
    echo   [!] Claude Code not detected (no .claude config found)
)

echo.
echo [4/5] 9Router integration
echo.
echo   For 9Router (Node.js):
echo     npm install vision-skills
echo     import { VisionSkills } from 'vision-skills'
echo.
echo   For 9Router (other language):
echo     npx vision-skills serve
echo     POST http://localhost:8000/v1/analyze
echo.

echo [5/5] Installing vision-skills globally...
call npm install -g vision-skills 2>&1 | findstr /v "npm WARN"
echo   ✓ vision-skills installed globally
echo.
echo ============================================
echo  Setup complete!
echo ============================================
echo.
echo Next steps:
echo   1. Get a Gemini API key: https://aistudio.google.com/apikey
echo   2. Set env var: set GEMINI_API_KEYS=AIzaSy...
echo   3. Restart OpenCode/Claude Code
echo   4. Try: vision-skills analyze ./test.png
echo.
pause
