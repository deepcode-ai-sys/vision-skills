---
name: vision-skills
description: "Use when the user asks you to analyze, describe, read, or extract text from an image, screenshot, photo, document, or UI screenshot. Also use when they mention 'vision', 'see this image', 'OCR', 'read this picture', 'what's in this image', or 'analyze this screenshot'. Do NOT trigger on unrelated file operations (code editing, system commands, etc.)."
---

# Vision Skills

Turn images into **structured JSON** for AI models that can't read images or read them poorly.

## How it works

Vision Skills uses **Google Gemini** (free tier) to extract text, detect objects, build scene graphs, and reason about images — returning structured data your text-only model can understand.

**Free setup:** 1. Get a Gemini API key at https://aistudio.google.com/apikey (no credit card). 2. Set `GEMINI_API_KEY` env var. For higher rate limits, set multiple keys as `GEMINI_API_KEYS=key1,key2,key3`.

## MCP Server (recommended for OpenCode)

The easiest way to give this agent vision is through the built-in MCP server:

1. Add to `opencode.json`:
```json
{
  "mcp": {
    "vision-skills": {
      "type": "local",
      "command": ["npx", "vision-skills-mcp"],
      "env": { "GEMINI_API_KEYS": "your_key_here" }
    }
  }
}
```

2. The following tools become available:

### `analyze(image, mode?, depth?)`
Analyze an image and return structured JSON with entities, scene graph, tables, and reasoning.

- `image`: file path, URL, or base64 data URI
- `mode`: `"basic"` (OCR only), `"standard"` (OCR + detection + UI), `"advanced"` (+ semantic + reasoner), `"full"` (everything)
- `depth`: `"fast"` (single pass, default) or `"deep"` (tiled reading for dense images)

### `analyze_text(image, mode?)`
Same as `analyze` but returns a plain-text summary suitable for feeding directly into a text-only LLM.

### `health()`
Check if the Gemini API is configured correctly.

## CLI usage (for scripting, terminal)

```bash
# Install globally
npm install -g vision-skills

# Analyze an image
vision-skills analyze ./screenshot.png

# Get detailed output
vision-skills analyze ./img.jpg --mode advanced --json

# Pipe image data
cat screenshot.png | vision-skills analyze

# Start REST server (for non-Node apps)
GEMINI_API_KEYS=key1,key2 vision-skills serve
```

## SDK usage (for Node.js apps)

```typescript
import { VisionSkills } from 'vision-skills';

const vision = new VisionSkills({
  geminiApiKeys: [process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2],
});

const result = await vision.analyze('./screenshot.png', { mode: 'standard' });

// Pass the JSON to your text-only model
console.log(result.entities.filter(e => e.text).map(e => e.text));
```

## Processing modes

| Mode | What runs | Best for |
|------|-----------|----------|
| `basic` | OCR only | Quick text extraction |
| `standard` | OCR + detection + UI | Most images, screenshots |
| `advanced` | + semantic graph + reasoner | Rich real-world analysis |
| `full` | Everything | Maximum detail |

## Multi-key rotation

Free Gemini keys hit rate limits quickly. Provide several:
```json
{ "env": { "GEMINI_API_KEYS": "key1,key2,key3" } }
```

The pool rotates automatically, cooling down rate-limited keys and preferring recently-successful ones.

## Deep reading for dense images

Dense screenshots (dashboards, documents) may miss small text in a single pass. Enable tiled deep reading:
```json
{ "env": { "ANALYSIS_DEPTH": "deep" } }
```
This splits the image into overlapping tiles, reads each, and merges results. Slower but more thorough.

## REST API

Start the server: `GEMINI_API_KEYS=... vision-skills serve`

Endpoints:
- `POST /v1/analyze` — analyze an image
- `GET /health` — health check
- `GET /v1/health/providers` — provider status
- `GET /v1/cache/stats` — cache hit rate

## Links

- GitHub: https://github.com/deepcode-ai-sys/vision-skills
- npm: https://www.npmjs.com/package/vision-skills
- Issues: https://github.com/deepcode-ai-sys/vision-skills/issues
