# vision-skills

Converts images into structured JSON for LLMs and agents. Provides OCR, object detection, table extraction, UI-aware analysis, and scene graph reasoning via a cloud-backed vision pipeline with local preprocessing.

## Use cases

- **Screenshot/UI analysis** â€” extract text, buttons, menus, tables, and hierarchy from any screen
- **Document/table extraction** â€” invoices, dashboards, logs â†’ structured rows and columns
- **Agent tooling for text-only models** â€” MCP/CLI/REST/SDK bridge between images and LLMs without vision

## Install

```bash
npm install vision-skills
```

`sharp` is bundled. `fastify` is an optional peer dependency (server only).

## Getting started

```ts
import { VisionSkills } from 'vision-skills';

const vision = new VisionSkills({ geminiApiKey: process.env.GEMINI_API_KEY });
const result = await vision.analyze('./screenshot.png');
console.log(JSON.stringify(result, null, 2));
```

Input: file path, URL, base64 data URI, or Buffer.

### Provider options

| Provider | Cost | Key needed | Covers |
|----------|------|------------|--------|
| **Gemini** (default) | Free tier | `geminiApiKey` | OCR + detection + semantic + reasoning |
| **Google Cloud Vision** | Paid | `googleCloudVisionKey` | OCR + detection |
| **Gemini** (free, built-in) | Free | â€” | OCR + detection + semantic + reasoning |
| **Mock** | Free | none | Testing without API |
| **Rule-based UI** (local) | Free | none | UI element detection (always on) |

Provider priority: Gemini â†’ Google/Gemini â†’ mock. Local UI detection is always active.

### Free tier notes

- Gemini free tier: available at https://aistudio.google.com/apikey (no credit card)
- Rate-limited per key; provide multiple keys via `geminiApiKeys[]` or `GEMINI_API_KEYS` env for automatic rotation
- Mock providers (`useMockProviders: true`) let you test without any key

## Processing modes

| Mode | Runs | Best for |
|------|------|----------|
| `basic` | OCR only | Quick text extraction |
| `standard` | OCR + detection + UI | Most images, screenshots |
| `advanced` | + semantic graph + reasoner | Rich scene understanding |
| `full` | Everything | Maximum detail |

Mode auto-selects from image type when omitted.

## Output shape

```jsonc
{
  "schemaVersion": "3.1.0",
  "imageType": "screen_ui",
  "entities": [
    { "entityId": "e1", "label": "text_block", "bbox": [120,340,180,370],
      "confidence": 0.98, "text": "Login",
      "metadata": { "language": "en", "color": "#ffffff", "emphasis": "heading" } }
  ],
  "tables": [ /* structured rows/columns from dashboards, invoices */ ],
  "code": { "language": "python", "functions": ["render_video"], "errors": ["TypeError"] },
  "sceneGraph": { "spatial": [ { "subjectId": "e1", "relation": "above", "objectId": "e2" } ] },
  "reasonerOutput": { "summary": "...", "actionHints": [], "anomalies": [] }
}
```

Full schema: `src/core/types.ts` in the repo.

## Tiled analysis for dense images

Large screenshots (dashboards, documents) can miss small text in a single pass. Enable `analysisDepth: 'deep'` to split the image into overlapping tiles, read each region at higher resolution, and merge. Single-pass reads ~40-95 text blocks; tiled reads ~140-210.

## Multi-key rotation

Multiple Gemini keys share request load. Rate-limited keys cool down; successful keys are preferred. Configure via array or comma-separated env:

```ts
const vision = new VisionSkills({ geminiApiKeys: ["key1", "key2", "key3"] });
```

## Built-in providers

- **Gemini** (free) â€” OCR, object detection, semantic relationships, reasoning
- **Rule-based UI** (local, free) â€” UI element detection via edge detection
- **Google Cloud Vision** (paid) â€” OCR, object detection


## MCP / CLI / REST / SDK

| Interface | Use when |
|-----------|----------|
| **MCP server** (`vision-skills-mcp`) | AI assistants (OpenCode, Claude Code, Cursor, Continue, Copilot, VS Code, Cline...) |
| **CLI** (`vision-skills analyze`) | Terminal, scripts, CI pipelines |
| **REST** (`vision-skills serve`) | Non-Node apps (Python, Go, PHP...) |
| **SDK** (`new VisionSkills()`) | Node.js apps |

See [SKILL.md](SKILL.md) for per-platform MCP configuration. Setup scripts: `setup-integrations.bat` (Windows) and `setup-integrations.sh` (macOS/Linux).

## Configuration

```ts
new VisionSkills({
  geminiApiKey: '...',           // free tier (default)
  geminiApiKeys: ['...', '...'], // multiple keys for rotation
  googleCloudVisionKey: '...',   // optional paid
  anthropicApiKey: '...',        // optional paid
  vlmProvider: 'gemini',
  analysisDepth: 'fast',         // 'fast' | 'deep'
  cacheEnabled: true,
  useMockProviders: false,
});
```

All fields optional. Keys also read from `GEMINI_API_KEY`, `GEMINI_API_KEYS`, `GOOGLE_CLOUD_VISION_KEY`, `ANTHROPIC_API_KEY` env vars.

## Security

- URL inputs are checked against SSRF (localhost / private / reserved IPs blocked)
- Uploaded bytes validated by magic bytes, not extension
- Images resized before sending to providers

## Current limitations

- **Gemini verified live; Google Cloud Vision are fixture-tested only only.**
- **Free tier rate-limited.** Multi-key rotation mitigates this, but production volumes may need paid tiers.
- **Classifier is heuristic.** Image-type classification uses image statistics, not a trained model.
- **Segmentation, face, pose not implemented.** These are on the roadmap and skip gracefully if absent.
- **Cache is in-memory.** Provide a Redis-backed `CacheBackend` for multi-instance deployments.
- **REST server auth/rate limiting** are minimal. Add your own layer for public deployments.

## Roadmap

- Segmentation, face, and pose providers
- CLIP-based classifier (replaces heuristic)
- Redis cache backend
- Production auth/rate limiting

Contributions welcome â€” see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
