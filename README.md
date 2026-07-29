# vision-skills

Turn images into **structured JSON** for AI models that can't read images (or read them poorly). Cloud-only, multi-provider, plugin-based. No GPU required.

Give a text-only LLM (or a weak-vision model) a rich, structured description of any image: detected objects, OCR text, UI elements, spatial relationships, semantic relationships, and reasoning — all in one consistent JSON schema.

> **Status: early (0.1.0).** Core pipeline and providers are implemented and
> unit-tested, but provider response parsing is validated with fixtures, not
> live API calls yet. Verify with a real key before production use. See
> [Limitations](#limitations).

## Install

```bash
npm install vision-skills
```

`sharp` is bundled. `fastify` is an optional peer dependency (only if you use the server).

## Quick start (SDK) — FREE

The default provider is **Google Gemini**, which has a free tier (Google AI
Studio, **no credit card**). One key covers OCR, object detection with
bounding boxes, semantic relationships, and reasoning.

Get a free key at https://aistudio.google.com/apikey

```ts
import { VisionSkills } from 'vision-skills';

const vision = new VisionSkills({
  geminiApiKey: process.env.GEMINI_API_KEY, // free tier
});

const result = await vision.analyze('./screenshot.png', { mode: 'standard' });
console.log(JSON.stringify(result, null, 2));
```

Input can be a file path, URL, base64 data URI, or a `Buffer`.

### No API key at all? Use mock providers

```ts
const vision = new VisionSkills({ useMockProviders: true });
const result = await vision.analyze(imageBuffer, { mode: 'standard' });
```

### Paid providers (optional, higher quality / throughput)

```ts
const vision = new VisionSkills({
  googleCloudVisionKey: process.env.GOOGLE_CLOUD_VISION_KEY, // OCR + detection
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,            // Claude VLM
});
```

Provider priority: free **Gemini** is tried first; paid providers act as
fallbacks. Local UI detection is always on and always free.

## Processing modes

Modes trade cost for detail. The VLM (expensive) only runs in `advanced`/`full`.

| Mode | Providers | VLM? | Use for |
|------|-----------|------|---------|
| `basic` | OCR | no | Fast text extraction |
| `standard` | OCR + detection + UI | no | Most images, screenshots |
| `advanced` | + semantic graph + reasoner | yes | Rich real-world analysis |
| `full` | everything | yes | Maximum detail |

If you don't pass a `mode`, the image classifier picks one automatically.

## Output shape

```jsonc
{
  "schemaVersion": "3.1.0",
  "imageType": "screen_ui",
  "modeUsed": "standard",
  "entities": [
    { "entityId": "e1", "label": "text_block", "bbox": [120,340,180,370],
      "confidence": 0.98, "text": "Login", "sourcePlugins": ["google_vision_ocr"] }
  ],
  "sceneGraph": {
    "spatial": [{ "subjectId": "e1", "relation": "above", "objectId": "e2", "confidence": 1 }],
    "semantic": []
  },
  "reasonerOutput": null,
  "providerResults": [ /* per-provider details */ ],
  "costActualTotal": 0.003,
  "latencyMsTotal": 210.5
}
```

## Optional REST server

Requires `fastify` (`npm install fastify`).

```ts
import { createServer } from 'vision-skills/server';

const app = await createServer({
  config: { googleCloudVisionKey: process.env.GOOGLE_CLOUD_VISION_KEY },
});
await app.listen({ port: 8000 });
```

Or attach to your own Fastify app:

```ts
import Fastify from 'fastify';
import { registerRoutes } from 'vision-skills/server';

const app = Fastify();
registerRoutes(app, { config: { /* ... */ } });
```

Endpoints: `POST /v1/analyze`, `GET /health`, `GET /v1/health/providers`, `GET /v1/cache/stats`.

## Custom providers

Implement `VisionPlugin` (or extend `BasePlugin`) and register it:

```ts
import { VisionSkills, BasePlugin, type PluginType, type RequestContext } from 'vision-skills';

class MyOCR extends BasePlugin {
  readonly name = 'my_ocr';
  readonly pluginType: PluginType = 'ocr';
  readonly provider = 'my-provider';

  protected async run(image: Buffer, ctx: RequestContext) {
    // call your API, return { confidence, text_blocks: [...] }
    return { confidence: 0.9, text_blocks: [] };
  }
  async healthCheck() { return true; }
}

const vision = new VisionSkills({ /* ... */ });
vision.registerPlugin(new MyOCR());
```

The orchestrator runs providers of the same type with automatic fallback and a circuit breaker.

## Configuration

```ts
new VisionSkills({
  geminiApiKey: '...',        // free tier (default provider)
  googleCloudVisionKey: '...', // optional paid
  anthropicApiKey: '...',      // optional paid
  vlmProvider: 'gemini',       // 'gemini' (free) | 'claude'
  geminiModel: 'gemini-2.0-flash',
  defaultMode: 'standard',
  enableSemanticRelationships: true,
  enableReasoner: true,
  maxImageSizeMb: 10,
  maxDimension: 2048,
  jpegQuality: 85,
  cacheEnabled: true,
  cacheTtlSeconds: 3600,
  useMockProviders: false,
});
```

All fields are optional. API keys fall back to `GEMINI_API_KEY`,
`GOOGLE_CLOUD_VISION_KEY`, and `ANTHROPIC_API_KEY` env vars.

## Built-in providers

**Free (default):**
- **Gemini** — OCR + object detection (with bounding boxes) + semantic + reasoning. Free tier, no credit card.
- **Rule-based UI** — local, no API cost, rectangle/UI element detection.

**Paid (optional fallbacks):**
- **Google Cloud Vision** — OCR (`DOCUMENT_TEXT_DETECTION`) + object detection (`OBJECT_LOCALIZATION`)
- **Claude Vision** — semantic relationships + reasoning

## Security notes

- URL inputs are checked against SSRF (localhost / private / reserved IPs are blocked).
- Uploaded bytes are validated by magic bytes, not just extension.
- Images are resized before being sent to providers to reduce token cost.

## Limitations

This is an early release. Be aware of the following before relying on it:

- **Live API parsing is unverified.** Provider response parsing (Gemini,
  Google Cloud Vision, Claude) is covered by fixture-based unit tests, but has
  not been validated end-to-end against live APIs. Test with a real key first.
- **Classifier is heuristic.** Image-type classification uses simple image
  statistics, not a trained model. A CLIP-based layer is planned.
- **Segmentation / face / pose are not implemented.** `advanced` mode
  currently runs OCR + detection + UI + VLM; dedicated segmentation, face, and
  pose providers are on the roadmap and skip gracefully if absent.
- **Cache is in-memory by default.** For multi-instance deployments, provide a
  Redis-backed `CacheBackend`.
- **Rate limiting / auth** for the REST server are minimal; add your own layer
  for public deployments.

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

