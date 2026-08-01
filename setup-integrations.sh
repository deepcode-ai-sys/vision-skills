#!/usr/bin/env bash
set -euo pipefail

VERSION="1.2"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MERGER="$SCRIPT_DIR/scripts/add-json-mcp.mjs"
VERSION_CHECK="$SCRIPT_DIR/scripts/check-node-version.mjs"
MCP_ENTRY="$SCRIPT_DIR/dist/mcp-server.js"

echo "Vision Skills v${VERSION} integration setup"

for command_name in node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: $command_name is required. Install Node.js from https://nodejs.org" >&2
    exit 1
  fi
done

node "$VERSION_CHECK"

if [[ ! -f "$MERGER" ]]; then
  echo "Error: missing setup helper: $MERGER" >&2
  exit 1
fi

echo "Installing local dependencies..."
if [[ -f "$SCRIPT_DIR/package-lock.json" && ! -d "$SCRIPT_DIR/node_modules" ]]; then
  npm --prefix "$SCRIPT_DIR" ci
else
  npm --prefix "$SCRIPT_DIR" install
fi
echo "Building the local MCP server..."
npm --prefix "$SCRIPT_DIR" run build
if [[ ! -f "$MCP_ENTRY" ]]; then
  echo "Error: build did not create $MCP_ENTRY" >&2
  exit 1
fi

while true; do
  read -rsp "Gemini API key: " GEMINI_KEY
  echo
  [[ "$GEMINI_KEY" == AIza* ]] && break
  echo "Invalid key format. Gemini API keys normally start with AIza."
done

configure_json() {
  VISION_SKILLS_SETUP_KEY="$GEMINI_KEY" \
    VISION_SKILLS_MCP_COMMAND=node \
    VISION_SKILLS_MCP_ENTRY="$MCP_ENTRY" \
    node "$MERGER" "$1" "$2"
}

install_skill() {
  local skill_dir="$HOME/.config/opencode/skills/vision-skills"
  mkdir -p "$skill_dir"
  cp "$SCRIPT_DIR/SKILL.md" "$skill_dir/SKILL.md"
  echo "Installed OpenCode skill in $skill_dir"
}

setup_opencode() {
  install_skill
  configure_json "$HOME/.config/opencode/opencode.json" opencode
}

setup_claude() {
  configure_json "$HOME/.claude.json" standard
}

setup_codex() {
  if ! command -v codex >/dev/null 2>&1; then
    echo "Error: Codex CLI is not installed; cannot safely edit its TOML config." >&2
    return 1
  fi
  if codex mcp add vision-skills --env "GEMINI_API_KEYS=$GEMINI_KEY" -- node "$MCP_ENTRY"; then
    echo "Configured vision-skills through Codex CLI."
  else
    echo "Codex may already contain vision-skills. Check with: codex mcp list" >&2
    return 1
  fi
}

setup_cursor() {
  configure_json "$HOME/.cursor/mcp.json" standard
}

setup_continue() {
  configure_json "$SCRIPT_DIR/.continue/mcpServers/vision-skills.json" continue
}

setup_vscode() {
  configure_json "$SCRIPT_DIR/.vscode/mcp.json" vscode
}

setup_cline() {
  configure_json "$HOME/.cline/mcp.json" standard
}

setup_env() {
  local env_file="$HOME/.vision-skills.env"
  printf 'export GEMINI_API_KEYS=%q\n' "$GEMINI_KEY" > "$env_file"
  chmod 600 "$env_file"
  echo "Saved $env_file. Load it with: source \"$env_file\""
}

setup_all() {
  setup_opencode
  setup_claude
  setup_cursor
  setup_continue
  setup_vscode
  setup_cline
  if command -v codex >/dev/null 2>&1; then
    setup_codex || true
  fi
}

while true; do
  cat <<'MENU'

1) OpenCode
2) Claude Code
3) OpenAI Codex CLI
4) Cursor
5) Continue
6) VS Code / GitHub Copilot
7) Cline
A) Configure all supported clients
B) Save key to a private env file
0) Exit
MENU
  read -rp "Select: " choice
  case "$choice" in
    1) setup_opencode ;;
    2) setup_claude ;;
    3) setup_codex ;;
    4) setup_cursor ;;
    5) setup_continue ;;
    6) setup_vscode ;;
    7) setup_cline ;;
    A|a) setup_all ;;
    B|b) setup_env ;;
    0) exit 0 ;;
    *) echo "Invalid selection." ;;
  esac
  echo "Restart the configured client to load the MCP server."
done
