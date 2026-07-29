---
name: vision-skills
description: "Use when the user asks you to analyze, describe, read, or extract text from an image, screenshot, photo, document, or UI screenshot. Also use when they mention 'vision', 'see this image', 'OCR', 'read this picture', 'what's in this image', or 'analyze this screenshot'. Do NOT trigger on unrelated file operations (code editing, system commands, etc.)."
---

# Vision Skills

Give **text-only AI models** the ability to see and understand images. Works by calling a Gemini vision model behind the scenes and returning structured data.

## How to set up

### Option A: Run the setup script (recommended)
Clone the repo and run the setup script — it will ask for your Gemini API key and configure everything automatically:

```bash
# Windows
setup-integrations.bat

# macOS / Linux
chmod +x setup-integrations.sh && ./setup-integrations.sh
```

The script will:
1. Prompt for your Gemini API key (free, no credit card)
2. Install the `vision-skills` package globally
3. Let you choose which platforms to integrate
4. Create config files with your key already filled in
5. Copy this SKILL.md to the right location for OpenCode

### Option B: Manual setup
1. Get a free Gemini API key at https://aistudio.google.com/apikey
2. Install: `npm install -g vision-skills`
3. Configure MCP for your platform (see below)

## How it works (for the AI model)

When the user provides an image, call one of the MCP tools below. The tool reads the image, sends it to Gemini (which has vision capability), and returns structured data. You as a text-only model just read the result — no need to process image pixels yourself.

```
User: "What's in this image?"
  → You detect this is about an image
  → Call MCP tool: analyze("/path/to/image.jpg")
  → Tool returns JSON with text, objects, tables, colors, relationships
  → You read the JSON and answer the user
```

## Available tools (via MCP)

| Tool | Description |
|------|-------------|
| `analyze(image, mode?, depth?)` | Return full structured JSON (entities, scene graph, tables, code, colors) |
| `analyze_text(image, mode?)` | Return plain-text summary (easier for text-only LLMs to consume) |
| `health()` | Check if the API key is configured correctly |

### Parameters

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `image` | file path, URL, or base64 | required | The image to analyze |
| `mode` | `basic`, `standard`, `advanced`, `full` | `standard` | Trade detail for speed/cost |
| `depth` | `fast`, `deep` | `fast` | `deep` tiles large images for thorough reading |

### Processing modes

| Mode | Runs | Use for |
|------|------|---------|
| `basic` | OCR only | Quick text extraction |
| `standard` | OCR + detection + UI elements | Most images, screenshots |
| `advanced` | + semantic graph + reasoner | Rich scene understanding |
| `full` | Everything | Maximum detail |

## MCP configuration by platform

### OpenCode
Add to `~/.config/opencode/opencode.json`:
```json
{
  "mcp": {
    "vision-skills": {
      "type": "local",
      "command": ["npx", "vision-skills-mcp"],
      "env": { "GEMINI_API_KEYS": "AIzaSy..." }
    }
  }
}
```

### Claude Code CLI
Add to `~/.claude/claude.json`:
```json
{
  "mcpServers": {
    "vision-skills": {
      "command": "npx",
      "args": ["vision-skills-mcp"],
      "env": { "GEMINI_API_KEYS": "AIzaSy..." }
    }
  }
}
```

### Cursor
Add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "vision-skills": {
      "command": "npx",
      "args": ["vision-skills-mcp"],
      "env": { "GEMINI_API_KEYS": "AIzaSy..." }
    }
  }
}
```

### Continue.dev
Add to `~/.continue/config.json`:
```json
{
  "experimental": {
    "mcpServers": {
      "vision-skills": {
        "command": "npx",
        "args": ["vision-skills-mcp"],
        "env": { "GEMINI_API_KEYS": "AIzaSy..." }
      }
    }
  }
}
```

### GitHub Copilot
Add to `~/.github/copilot.json` (MCP support rolling out gradually):
```json
{
  "mcpServers": {
    "vision-skills": {
      "command": "npx",
      "args": ["vision-skills-mcp"],
      "env": { "GEMINI_API_KEYS": "AIzaSy..." }
    }
  }
}
```

### VS Code
Add to `.vscode/mcp.json`:
```json
{
  "servers": {
    "vision-skills": {
      "type": "stdio",
      "command": "npx",
      "args": ["vision-skills-mcp"]
    }
  }
}
```
(VS Code reads `GEMINI_API_KEYS` from environment variables.)

### Cline / Roo / Kilo Code
Add to `.cline/mcp.json`, `.roo/mcp.json`, or `.kilocode/mcp.json`:
```json
{
  "mcpServers": {
    "vision-skills": {
      "command": "npx",
      "args": ["vision-skills-mcp"],
      "env": { "GEMINI_API_KEYS": "AIzaSy..." }
    }
  }
}
```

### OpenAI Codex CLI
Add to `~/.codex/config.json`:
```json
{
  "mcpServers": {
    "vision-skills": {
      "command": "npx",
      "args": ["vision-skills-mcp"],
      "env": { "GEMINI_API_KEYS": "AIzaSy..." }
    }
  }
}
```

### 9Router
```ts
import { VisionSkills } from 'vision-skills';
const vision = new VisionSkills({ geminiApiKeys: ["AIzaSy..."] });
const result = await vision.analyze(imageBuffer);
```

## CLI usage (standalone, no MCP needed)

```bash
# Analyze an image
vision-skills analyze ./screenshot.png

# With mode and depth options
vision-skills analyze ./img.jpg --mode advanced --json

# Pipe image data
cat screenshot.png | vision-skills analyze

# Start REST server (for non-Node apps)
GEMINI_API_KEYS=AIzaSy... vision-skills serve
```

## Multi-key rotation

Free Gemini keys have rate limits. Provide several keys and the pool rotates automatically:
```
GEMINI_API_KEYS=key1,key2,key3,key4
```
Rate-limited keys get a cooldown; successful keys are preferred.

## Deep reading for dense images

For large dashboards or documents packed with small text, set:
```
ANALYSIS_DEPTH=deep
```
This tiles the image, reads each region at higher resolution, and merges — catching small text a single pass misses. Single-pass reads ~40-95 blocks; deep reads ~140-210 blocks.

## What the output includes

- **Text blocks** — every visible text with bounding box position
- **Object labels** — detected objects with bounding boxes
- **Tables** — structured rows/columns from dashboards, invoices, logs
- **Code context** — language, function names, errors, stack traces (if the image shows code)
- **Text attributes** — color (hex) and emphasis (heading, error, muted, bold, link...)
- **Scene graph** — spatial relationships (left_of, above, contains, near...)
- **UI hierarchy** — containment tree (which element contains which)
- **Semantic relationships** — holding, using, part_of, labels, controls... (advanced+ modes)
- **Reasoning** — summary, UI state, action hints, anomaly detection (advanced+ modes)
- **Action map** — clickable elements, typeable fields (advanced+ modes)

## Links

- GitHub: https://github.com/deepcode-ai-sys/vision-skills
- npm: https://www.npmjs.com/package/vision-skills
- Issues: https://github.com/deepcode-ai-sys/vision-skills/issues
- Setup scripts: `setup-integrations.bat` (Windows) / `setup-integrations.sh` (macOS/Linux)
