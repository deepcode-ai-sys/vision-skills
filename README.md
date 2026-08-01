# vision-skills

`vision-skills` converts images into structured JSON for LLMs and agents. The package provides an SDK, CLI, hardened optional REST adapter, and an MCP server built on the official Model Context Protocol SDK. Gemini is the built-in general provider; explicit HTTP specialist routes can add or replace OCR, object, UI, table, region, layout, and code extraction.

No specialist models are bundled. PaddleOCR, Docling, OmniParser, and OpenAI-compatible local multimodal models run as services that you configure.

## Quick Setup

Clone the repository, then run the platform setup script from any working directory. It validates Node.js >=20.9, installs dependencies from the local lockfile/package, builds the project locally, and configures supported clients to run the clone's absolute `dist/mcp-server.js` with Node.

Windows (primary setup path):

```bat
git clone https://github.com/deepcode-ai-sys/vision-skills.git
vision-skills\setup-integrations.bat
```

macOS/Linux:

```bash
git clone https://github.com/deepcode-ai-sys/vision-skills.git
./vision-skills/setup-integrations.sh
```

Restart the configured client afterward. Keep the clone in place because client configuration points to its local MCP entry file.

The npm registry install below will be available only after `vision-skills` is published:

```bash
npm install vision-skills
```

Requirements:

- Node.js >=20.9
- A Gemini API key for the built-in OCR/detection path, an explicit specialist OCR replacement, or `useMockProviders: true` for tests
- Fastify 5 (`^5.11.0`) only when using `vision-skills/server` (optional peer dependency)

Set one Gemini key or a comma-separated key pool:

```bash
export GEMINI_API_KEY="your_key_here"
export GEMINI_API_KEYS="key1,key2,key3"
```

## SDK

```ts
import { VisionSkills } from 'vision-skills';

const vision = new VisionSkills({
  geminiApiKey: process.env.GEMINI_API_KEY,
});

// mode defaults to "auto" in the SDK.
const result = await vision.analyze('./screenshot.png');
console.log(result.modeUsed, result.provenance.modeSelectionReason);
```

Input can be a file path, HTTP(S) URL, image data URI, `Buffer`, or `Uint8Array`. SDK calls also accept an `AbortSignal`, a progress callback, a budget guard, and `fast` or `deep` analysis depth:

```ts
const controller = new AbortController();
const result = await vision.analyze('./dashboard.png', {
  mode: 'full',
  analysisDepth: 'deep',
  signal: controller.signal,
  reportProgress: (progress, message) => console.log(progress, message),
});
```

`deep` adds tiled provider passes for large or dense images. It can improve small-text coverage but increases calls, latency, and provider usage. `fast` is the default.

## Mode Policies

Modes are enforced policies, not quality labels:

| Mode | Provider types | Combined structured fields | Semantic relationships | Reasoner |
| --- | --- | --- | --- | --- |
| `basic` | OCR | No | No | No |
| `standard` | OCR, object detection, UI detection | Yes | No | No |
| `advanced` | OCR, object detection, UI detection | Yes | Yes | No |
| `full` | OCR, object detection, UI detection | Yes | Yes | Yes |

Combined structured fields are tables, regions, layout/lighting/color, and code context made available by the built-in combined analysis pass or configured specialists. A field can still be empty when a provider does not detect or support it.

These policies also govern configured specialist routes. `basic` runs only OCR routes; `standard`, `advanced`, and `full` may run OCR, object, UI, table, region, layout, and code routes. Provider declarations and routes remain explicit, but a route outside the selected mode policy is not called.

The SDK's `defaultMode` is truly `auto`, not an alias for `standard`. Auto routing uses local image heuristics:

- A confident simple document without UI elements selects `basic`.
- A document with UI elements, a screen UI, or a real-world image selects `standard`.
- A `mixed` or low-confidence classification fails safe to `standard`.
- A non-positive budget forces `basic`; a budget below 1 downgrades requested `advanced`/`full` to `standard`.

Explicit SDK modes bypass classifier mode selection, subject to the budget guard. MCP and REST both accept `auto`; when `mode` is omitted they leave it unset so the SDK's configured `defaultMode` applies (which is `auto` unless changed). The CLI currently defaults to `standard`.

`enableSemanticRelationships` and `enableReasoner` can disable features allowed by a mode, but cannot enable them in a lower mode. In particular, `enableReasoner: true` does not add reasoning to `advanced`.

## Output Semantics

The full schema is defined in `src/core/types.ts`. A representative entity is serialized as:

```json
{
  "entityId": "...",
  "label": "text_block",
  "bbox": { "x1": 120, "y1": 340, "x2": 180, "y2": 370 },
  "confidence": 0.9,
  "text": "Login",
  "metadata": { "language": "en" },
  "sourcePlugins": ["gemini_ocr"]
}
```

Final SDK/REST/MCP entity, table, and region boxes are `BoundingBox` objects serialized as `{ x1, y1, x2, y2 }` in pixels. Plugin payloads and specialist canonical-v1 HTTP payloads use `[x1, y1, x2, y2]` arrays at those integration boundaries.

Confidence has several distinct meanings:

- `entity.confidence` is provider-reported confidence normalized to 0..1. Specialist codecs preserve unavailable confidence as `null`; built-in legacy plugin normalization may use `0` when confidence is absent.
- Top-level `confidence` is the arithmetic mean of the local classifier confidence and all returned built-in plugin result confidences (failed plugin results generally contribute `0`). It is not a calibrated probability, does not include specialist entity confidence, and must not be interpreted as end-to-end accuracy.
- `reasonerOutput.reasoningConfidence` is the reasoner's self-reported confidence and is separate from top-level confidence.

Provenance and usage are also separate:

- `provenance` records a per-request ID, requested mode (including `auto`), selection reason, classifier layer, selected provider names, and `cacheHit`.
- `providerResults` records built-in plugin latency, cost estimate/actual, confidence, warnings, and errors.
- `telemetry.gemini` records observed Gemini calls and reported input/output/total tokens. Values remain zero when unavailable or unused.
- `route` and `usage` exist only when specialist routing is configured. They record configured chains, attempts, selected providers, grouped HTTP call counts, per-provider counts, call latency, and failures. They are operational metrics, not billing or accuracy claims.
- Cached responses get a new request ID and `cacheHit: true`; provider output and original telemetry otherwise come from the cached response.

## Injectable Cache

Caching is enabled by default with an in-process TTL backend (one hour; PII-flagged built-in results use five minutes). Inject a shared backend through the exported `CacheBackend` contract:

```ts
import { VisionSkills, type CacheBackend } from 'vision-skills';

const cacheBackend: CacheBackend = {
  async get(key) { return redis.get(key); },
  async set(key, value, ttlSeconds) { await redis.set(key, value, { EX: ttlSeconds }); },
  async delete(key) { await redis.del(key); },
  async clear() { return clearVisionNamespaceInYourBackend(); },
};

const vision = new VisionSkills({ cacheBackend, cacheTtlSeconds: 900 });
```

The backend owns namespace-safe `clear()` behavior. Specialist PII is not independently classified, so operators handling sensitive images should disable caching or enforce an appropriate backend retention policy.

## Specialist Providers

Specialists are opt-in and explicit. Every provider declares a protocol, endpoint, and capabilities; every used capability declares an ordered provider chain and either `augment` or `replace`.

- `augment` retains the built-in result and appends/composes specialist output.
- `replace` suppresses or removes the built-in output for that capability. An OCR replacement also allows initialization without a Gemini key.
- Fallback occurs only inside the declared chain. If every provider in any configured route fails, the request fails visibly.
- Calls to the same provider for multiple routed capabilities are grouped when possible.
- Configuring a provider alone does nothing; an explicit route is required.

Supported protocols are `canonical-v1`, `paddleocr-classic`, `docling-json`, `omniparser-v2`, and `openai-chat-completions`.

### PaddleOCR

```ts
const vision = new VisionSkills({
  specialists: {
    providers: [{
      id: 'paddle-local',
      protocol: 'paddleocr-classic',
      endpoint: 'http://127.0.0.1:9001/ocr',
      capabilities: ['ocr'],
      timeoutMs: 20_000,
    }],
    routes: { ocr: { providers: ['paddle-local'], mode: 'replace' } },
  },
});
```

The adapter accepts the documented object and classic tuple JSON forms and converts polygons to pixel `[x1,y1,x2,y2]` canonical boxes.

### Docling

```ts
const vision = new VisionSkills({
  geminiApiKey: process.env.GEMINI_API_KEY,
  specialists: {
    providers: [{
      id: 'docling-local',
      protocol: 'docling-json',
      endpoint: 'http://127.0.0.1:9002/convert',
      capabilities: ['ocr', 'tables'],
    }],
    routes: {
      ocr: { providers: ['docling-local'], mode: 'augment' },
      tables: { providers: ['docling-local'], mode: 'replace' },
    },
  },
});
```

The endpoint must return the supported `DoclingDocument` JSON shape. The package does not launch Docling or convert arbitrary Docling API responses automatically.

### OmniParser

```ts
const vision = new VisionSkills({
  geminiApiKey: process.env.GEMINI_API_KEY,
  specialists: {
    providers: [{
      id: 'omniparser-local',
      protocol: 'omniparser-v2',
      endpoint: 'http://127.0.0.1:9003/parse',
      capabilities: ['ui'],
    }],
    routes: { ui: { providers: ['omniparser-local'], mode: 'replace' } },
  },
});
```

### OpenAI-Compatible Local VLM

```ts
const vision = new VisionSkills({
  specialists: {
    providers: [{
      id: 'local-vlm',
      protocol: 'openai-chat-completions',
      endpoint: 'http://127.0.0.1:8000/v1/chat/completions',
      model: 'Qwen2.5-VL',
      apiKey: process.env.LOCAL_VLM_API_KEY,
      capabilities: ['ocr', 'objects', 'ui', 'tables', 'regions', 'layout', 'code'],
      timeoutMs: 60_000,
      maxResponseBytes: 5_000_000,
    }],
    routes: {
      ocr: { providers: ['local-vlm'], mode: 'replace' },
      objects: { providers: ['local-vlm'], mode: 'replace' },
      ui: { providers: ['local-vlm'], mode: 'replace' },
      tables: { providers: ['local-vlm'], mode: 'replace' },
      regions: { providers: ['local-vlm'], mode: 'replace' },
      layout: { providers: ['local-vlm'], mode: 'replace' },
      code: { providers: ['local-vlm'], mode: 'replace' },
    },
  },
});
```

The OpenAI-compatible endpoint must support chat completions with image data URLs and return strict canonical-v1 JSON in `choices[0].message.content`. Compatibility with a text API alone is insufficient.

Specialist endpoints are trusted operator configuration. Localhost is intentionally allowed, redirects are disabled, timeouts/cancellation and response byte limits are enforced, response schemas are validated, and auth headers can be supplied. The specialist transport does not apply the image-input SSRF policy to configured endpoints; use HTTPS, authentication, and network policy for non-local services.

## MCP Server

After local setup, the server entry is `dist/mcp-server.js` and clients run it with Node using its absolute path.

The server uses `@modelcontextprotocol/sdk`, stdio transport, registered tools, Zod input schemas, and standards-compliant structured tool errors.

| Tool | Behavior |
| --- | --- |
| `analyze` | Bounded structured analysis; accepts `auto` or a fixed mode, and omission inherits the SDK default; optional `fast`/`deep` depth |
| `analyze_text` | Bounded text summary; accepts `auto` or a fixed mode, and omission inherits the SDK default |
| `health` | Provider readiness report |
| `clipboard` | Windows-only PNG capture returned as official MCP image content; images are never truncated and inputs over the 10 MiB byte cap return an explicit error |

Analysis forwards MCP cancellation to image/provider work and emits progress notifications when the client supplies a progress token. Analysis and health output defaults to a 200,000-character serialized-payload bound (`maxOutputChars`) and includes a fixed numeric `truncation` metadata envelope: untruncated output is under `data`; truncated output is under `json`. The bound is not a strict limit on the complete MCP wire message and does not limit provider work or in-memory response construction. The fixed envelope contains no user-provided strings. Clipboard images instead use lossless MCP image content and the separate byte cap described above; clients should expose that image content for direct analysis or mediate a subsequent analysis call rather than expect a data URI.

The setup scripts securely merge the local MCP command into supported client configuration while preserving unrelated fields. The Gemini key is supplied to JSON clients through the MCP server environment rather than the command arguments.

## REST Server

```ts
import { createServer } from 'vision-skills/server';

const app = await createServer({
  apiKey: process.env.VSKILLS_API_KEY,
  config: { geminiApiKey: process.env.GEMINI_API_KEY },
});
await app.listen({ host: '127.0.0.1', port: 8000 });
```

Endpoints:

| Method | Endpoint | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | None | Process liveness only |
| `GET` | `/ready` | None | Provider readiness; 200 or 503 |
| `POST` | `/v1/analyze` | Required remotely | Analyze an image |
| `GET` | `/v1/health/providers` | Required remotely | Provider health detail |
| `GET` | `/v1/cache/stats` | Required remotely | Cache counters |
| `DELETE` | `/v1/cache` | Required remotely | Clear the configured cache backend |

Secure defaults and limits:

- Loopback clients may be unauthenticated by default. Non-loopback access returns 503 until `VSKILLS_API_KEY` or `apiKey` is configured, then requires a timing-safe `X-API-Key` comparison.
- Remote local-file paths are rejected unless `allowRemoteLocalPaths: true` is explicitly set.
- CORS headers are absent unless an exact `corsOrigins` allowlist is configured.
- Default concurrency is 4 analysis requests; excess requests receive 429 with `Retry-After: 1`.
- Default request timeout is 120 seconds and client disconnects propagate cancellation.
- Default returned output bound is 2,000,000 characters. Default image body limit is derived from the 10 MB image limit for base64 JSON plus 64 KiB overhead.
- `/health` proves only that the process is live. Use `/ready` for provider readiness.

The standalone `vision-skills serve` command listens on all interfaces. Set `VSKILLS_API_KEY` before exposing it, and place it behind TLS and infrastructure rate limiting for network deployment.

## Image Security and Limits

Defaults are 10 MB decoded input, 40 million source pixels, 2048 pixels maximum output dimension, 15-second URL fetch timeout, and JPEG quality 85. PNG is retained for alpha images. JPEG, PNG, GIF, and WebP magic bytes are accepted; preprocessing behavior remains subject to Sharp's decoder support.

For image URLs, the loader permits only HTTP(S), rejects credentials and explicit ports, blocks redirects, resolves and rejects non-unicast addresses (including loopback/private/link-local), streams with a size limit, and validates downloaded magic bytes.

Important caveat: DNS is checked before `fetch`, but the validated address is not pinned to the connection. A hostile or compromised DNS service could change the answer between validation and connection (DNS rebinding/time-of-check to time-of-use). Do not treat arbitrary image URLs as a complete SSRF sandbox. For high-risk deployments, fetch through an egress proxy that pins resolved addresses, allowlist origins, or disable URL input at the application boundary.

Local SDK paths reject `..` but are not confined to an application root. Treat local path input as trusted, and keep remote local paths disabled.

## Benchmark

```bash
npm run benchmark:mock
```

The mock profile is a deterministic pipeline smoke check. It generates an image, starts a loopback canonical-v1 HTTP provider, and invokes the public SDK routing, adapter, composition, and response packaging before deriving metrics from the actual result. Box matching is category-aware (`ocr`, `object`, or `ui`), so overlapping boxes from different categories cannot match. Perfect scores validate this plumbing only; they do not measure Gemini, PaddleOCR, Docling, OmniParser, a local VLM, or real-image accuracy.

No generic local/live scripts are published because the package cannot supply representative external services, credentials, or independently prepared expected data. Add a project-specific runner with recorded provider/model versions, warmup policy, and repeated latency measurements before making a live accuracy claim.

See `benchmark/README.md` for metric definitions and profile semantics.

## Production Audit Status

The current package includes automated tests for schema validation, specialist fallback/composition, MCP protocol behavior, output bounds, URL blocking, REST authentication, CORS preflight, remote path rejection, concurrency, and cancellation/timeouts. CI covers Node 20.9, 22, and 24 and performs type checking, linting, build, tests, the deterministic mock benchmark, package dry-run validation, and installed-tarball import/binary/benchmark smoke tests.

This is not a claim of full production readiness. There has been no documented independent security audit or penetration test, no committed live-provider accuracy evaluation, and no production SLO/load or failover certification. Before deployment, validate chosen providers and models on representative data, review privacy/retention requirements, constrain egress and URL inputs, use a shared cache deliberately, terminate TLS, add infrastructure rate limits/observability, and test cancellation and failure behavior under load.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
npm run benchmark:mock
npm pack --dry-run
```

Version `0.1.0` remains the current package version while the next changes are tracked under `Unreleased` in `CHANGELOG.md`.

## License

MIT
