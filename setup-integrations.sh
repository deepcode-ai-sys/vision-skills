#!/usr/bin/env bash
set -e

VERSION="1.0"

echo "============================================"
echo " Vision Skills v${VERSION} - Setup Integrations"
echo " Bien AI text-only thanh AI biet nhin anh"
echo "============================================"
echo ""

# ---- Prerequisites ----
if ! command -v npx &>/dev/null; then
  echo "[!] Node.js npx not found. Install from https://nodejs.org"
  exit 1
fi

# ---- Get API key ----
while true; do
  echo "Ban can 1 Gemini API key (free, khong can the tin dung)"
  echo "Lay key tai: https://aistudio.google.com/apikey"
  echo ""
  read -rp "Nhap Gemini API key cua ban: " GEMINI_KEY
  echo ""

  if [[ -z "$GEMINI_KEY" ]]; then
    echo "[!] Vui long nhap key."
    echo ""
    continue
  fi

  if [[ "$GEMINI_KEY" != AIza* ]]; then
    echo "[!] Key khong hop le. Key Gemini thuong bat dau bang AIza..."
    echo ""
    continue
  fi

  break
done

# ---- Install global ----
echo ""
echo "Dang cai dat vision-skills global..."
npm install -g vision-skills 2>&1 | grep -v "npm WARN" || true
echo "+ Da cai dat."

# ---- Helper ----
make_json() {
  mkdir -p "$(dirname "$1")"
  echo "$2" > "$1"
  echo "+ Created $1"
}

menu() {
  echo ""
  echo "============================================"
  echo " Vision Skills v${VERSION}"
  echo " Key: ${GEMINI_KEY:0:12}... (da luu)"
  echo "============================================"
  echo ""
  echo "Chon nen tang can tich hop:"
  echo ""
  echo " 1) OpenCode"
  echo " 2) Claude Code CLI"
  echo " 3) OpenAI Codex CLI"
  echo " 4) Cursor"
  echo " 5) Continue (Continue.dev)"
  echo " 6) GitHub Copilot"
  echo " 7) VS Code"
  echo " 8) Cline / Roo / Kilo Code"
  echo " 9) 9Router"
  echo ""
  echo " A) Tat ca"
  echo " B) Chi cai global + set env"
  echo ""
  echo " 0) Thoat"
  echo ""
  read -rp "Chon (0-9, A, B): " choice

  case "$choice" in
    0) exit 0 ;;
    1) setup_opencode ;;
    2) setup_claude ;;
    3) setup_codex ;;
    4) setup_cursor ;;
    5) setup_continue ;;
    6) setup_copilot ;;
    7) setup_vscode ;;
    8) setup_cline ;;
    9) setup_9router ;;
    A|a) setup_all ;;
    B|b) setup_env ;;
    *) menu ;;
  esac
  menu
}

setup_opencode() {
  echo ""
  echo "--- OpenCode ---"
  ODIR="$HOME/.config/opencode/skills/vision-skills"
  mkdir -p "$ODIR"
  [ -f "./SKILL.md" ] && cp ./SKILL.md "$ODIR/SKILL.md" 2>/dev/null && echo "+ SKILL.md copied"
  CFG="$HOME/.config/opencode/opencode.json"
  [ ! -f "$CFG" ] && make_json "$CFG" "{ \"mcp\": { \"vision-skills\": { \"type\": \"local\", \"command\": [\"npx\", \"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"${GEMINI_KEY}\" } } } }" || echo "+ File exists, add MCP manually"
  echo "+ Done!"
  read -rp "Press Enter..."
}

setup_claude() {
  echo ""
  echo "--- Claude Code CLI ---"
  CFG="$HOME/.claude/claude.json"
  [ ! -f "$CFG" ] && make_json "$CFG" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"${GEMINI_KEY}\" } } } }" || echo "+ File exists."
  echo "+ Done!"
  read -rp "Press Enter..."
}

setup_codex() {
  echo ""
  echo "--- OpenAI Codex CLI ---"
  CFG="$HOME/.codex/config.json"
  [ ! -f "$CFG" ] && make_json "$CFG" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"${GEMINI_KEY}\" } } } }" || echo "+ File exists."
  echo "+ Done!"
  read -rp "Press Enter..."
}

setup_cursor() {
  echo ""
  echo "--- Cursor ---"
  CFG="$HOME/.cursor/mcp.json"
  [ ! -f "$CFG" ] && make_json "$CFG" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"${GEMINI_KEY}\" } } } }" || echo "+ File exists."
  echo "+ Done!"
  read -rp "Press Enter..."
}

setup_continue() {
  echo ""
  echo "--- Continue (Continue.dev) ---"
  CFG="$HOME/.continue/config.json"
  [ ! -f "$CFG" ] && make_json "$CFG" "{ \"experimental\": { \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"${GEMINI_KEY}\" } } } } }" || echo "+ File exists."
  echo "+ Done!"
  read -rp "Press Enter..."
}

setup_copilot() {
  echo ""
  echo "--- GitHub Copilot ---"
  CFG="$HOME/.github/copilot.json"
  [ ! -f "$CFG" ] && make_json "$CFG" "{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"${GEMINI_KEY}\" } } } }" || echo "+ File exists."
  echo "+ Done!"
  read -rp "Press Enter..."
}

setup_vscode() {
  echo ""
  echo "--- VS Code ---"
  echo " VS Code ho tro MCP. Them vao .vscode/mcp.json:"
  echo ""
  echo ' { "servers": { "vision-skills": {'
  echo '   "type": "stdio",'
  echo '   "command": "npx",'
  echo '   "args": ["vision-skills-mcp"] } } }'
  echo ""
  echo " (VS Code doc GEMINI_API_KEYS tu env)"
  read -rp "Press Enter..."
}

setup_cline() {
  echo ""
  echo "--- Cline / Roo / Kilo Code ---"
  echo " Them vao .cline/mcp.json (hoac .roo, .kilocode):"
  echo ""
  echo ' { "mcpServers": { "vision-skills": {'
  echo '   "command": "npx",'
  echo '   "args": ["vision-skills-mcp"] } } }'
  echo ""
  echo " (Doc key tu GEMINI_API_KEYS env)"
  read -rp "Press Enter..."
}

setup_9router() {
  echo ""
  echo "--- 9Router ---"
  echo " Node.js: npm install vision-skills"
  echo "   const v = new VisionSkills({ geminiApiKeys: [\"${GEMINI_KEY:0:12}...\"] })"
  echo ""
  echo " REST: npx vision-skills serve"
  echo "   POST http://localhost:8000/v1/analyze"
  read -rp "Press Enter..."
}

setup_all() {
  echo ""
  echo "--- Setup All ---"
  ODIR="$HOME/.config/opencode/skills/vision-skills"
  mkdir -p "$ODIR"
  [ -f "./SKILL.md" ] && cp ./SKILL.md "$ODIR/SKILL.md" 2>/dev/null
  for f in \
    "$HOME/.config/opencode/opencode.json:{ \"mcp\": { \"vision-skills\": { \"type\": \"local\", \"command\": [\"npx\", \"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"${GEMINI_KEY}\" } } } }" \
    "$HOME/.claude/claude.json:{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"${GEMINI_KEY}\" } } } }" \
    "$HOME/.cursor/mcp.json:{ \"mcpServers\": { \"vision-skills\": { \"command\": \"npx\", \"args\": [\"vision-skills-mcp\"], \"env\": { \"GEMINI_API_KEYS\": \"${GEMINI_KEY}\" } } } }"; do
    path="${f%%:*}"
    content="${f#*:}"
    [ ! -f "$path" ] && make_json "$path" "$content"
  done
  echo ""
  echo "+ Da cau hinh OpenCode + Claude Code + Cursor!"
  echo "+ Key da duoc dien tu dong."
  echo "+ Restart tool de nhan thay doi."
  read -rp "Press Enter..."
}

setup_env() {
  echo ""
  echo "--- Set env ---"
  echo "export GEMINI_API_KEYS='${GEMINI_KEY}'" >> "$HOME/.bashrc"
  echo "export GEMINI_API_KEYS='${GEMINI_KEY}'" >> "$HOME/.zshrc" 2>/dev/null || true
  echo "export GEMINI_API_KEYS='${GEMINI_KEY}'" >> "$HOME/.profile"
  echo "+ Da them vao .bashrc / .zshrc / .profile"
  echo "+ Mo terminal MOI hoac: source ~/.bashrc"
  echo ""
  echo " Kiem tra: vision-skills analyze ./anh.jpg"
  read -rp "Press Enter..."
}

menu
