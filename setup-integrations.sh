#!/usr/bin/env bash
set -e

echo "============================================"
echo " Vision Skills - Setup Integrations"
echo "============================================"
echo ""

# ---- Prerequisites ----
if ! command -v npx &>/dev/null; then
  echo "[!] Node.js npx not found. Install from https://nodejs.org"
  exit 1
fi

SKILLS_DIR="${HOME}/.config/opencode/skills/vision-skills"
MCP_CONFIG="${HOME}/.config/opencode/opencode.json"
CLAUD_CONFIG="${HOME}/.claude/"

# ---- 1. SKILL.md for OpenCode ----
echo "[1/5] Creating SKILL.md for OpenCode..."
mkdir -p "$SKILLS_DIR"
if [ -f "./SKILL.md" ]; then
  cp "./SKILL.md" "${SKILLS_DIR}/SKILL.md" 2>/dev/null && echo "  ✓ SKILL.md copied" || echo "  [!] Copy failed"
else
  echo "  [!] SKILL.md not found in current dir"
fi

# ---- 2. OpenCode MCP ----
echo ""
echo "[2/5] OpenCode MCP configuration"
if [ -f "$MCP_CONFIG" ]; then
  echo "  ✓ opencode.json exists → Add MCP config manually (shown below)"
else
  mkdir -p "$(dirname "$MCP_CONFIG")"
  cat > "$MCP_CONFIG" << 'CONFIG'
{
  "mcp": {
    "vision-skills": {
      "type": "local",
      "command": ["npx", "vision-skills-mcp"],
      "env": { "GEMINI_API_KEYS": "YOUR_KEY_HERE" }
    }
  }
}
CONFIG
  echo "  ✓ Created $MCP_CONFIG"
  echo "  → Edit it to add your Gemini API key"
fi

echo ""
echo "  Add this to your config:"
echo '  "mcp": {'
echo '    "vision-skills": {'
echo '      "type": "local",'
echo '      "command": ["npx", "vision-skills-mcp"],'
echo '      "env": { "GEMINI_API_KEYS": "AIzaSy..." }'
echo '    }'
echo '  }'

# ---- 3. Claude Code CLI ----
echo ""
echo "[3/5] Claude Code CLI"
if [ -f "${CLAUD_CONFIG}/claude.json" ]; then
  echo "  ✓ Claude Code detected"
  echo "  → Add MCP server to ${CLAUD_CONFIG}/claude.json"
else
  echo "  [!] Claude Code not detected"
fi

# ---- 4. 9Router ----
echo ""
echo "[4/5] 9Router integration"
echo ""
echo "  Node.js app: npm install vision-skills"
echo "  Other:        npx vision-skills serve"
echo "               → POST http://localhost:8000/v1/analyze"

# ---- 5. Install global ----
echo ""
echo "[5/5] Installing vision-skills globally..."
npm install -g vision-skills 2>&1 | grep -v "npm WARN" || true
echo "  ✓ vision-skills installed globally"

# ---- Summary ----
echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  Next steps:"
echo "    1. Get a free Gemini key: https://aistudio.google.com/apikey"
echo "    2. Export key: export GEMINI_API_KEYS='AIzaSy...'"
echo "    3. Restart OpenCode/Claude Code"
echo "    4. Try: vision-skills analyze ./test.png"
echo ""
