# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Official MCP server.** The MCP adapter now uses the official Model Context
  Protocol SDK with registered tools, structured content, standards-compliant
  errors, bounded output/truncation metadata, cancellation, and progress
  notifications.
- **Hardened REST adapter.** Added liveness/readiness endpoints, timing-safe API
  key checks for remote access, remote local-path rejection, exact-origin CORS,
  concurrency and timeout limits, cancellation on disconnect, bounded output,
  and cache administration endpoints.
- **Injectable cache.** `cacheBackend` accepts the exported asynchronous
  `CacheBackend` contract; the in-memory TTL backend remains the default.
- **Response confidence, provenance, and telemetry.** Top-level output now
  distinguishes aggregate request confidence, request/provider/cache
  provenance, and Gemini call/token telemetry.
- **Deterministic mock benchmark.** Reports CER, WER, IoU box metrics, calls,
  and p50/p95 harness latency from committed canonical fixture data.
  It validates metric plumbing only and does not measure live provider accuracy.
- **Rich structured analysis.** Added text color/emphasis metadata, code
  context, tables, regions, layout/lighting/color, and opt-in tiled `deep`
  analysis for dense images.
- **Multi-key Gemini rotation.** `geminiApiKeys` and `GEMINI_API_KEYS` provide
  ordered key-pool input with cooldown and retry behavior.

### Changed
- Node.js >=20.18 is now the supported runtime and CI floor.
- The optional Fastify peer and development server now require secure Fastify 5
  (`^5.11.0`), and the test stack uses Vitest 4 with a Node 20.18-compatible Vite 6.
- The SDK default mode is now true `auto`; explicit `basic`, `standard`,
  `advanced`, and `full` requests remain available. Auto selects `basic` for a
  confident simple document and otherwise fails safe to `standard`.
- Mode policy is exact: Basic runs OCR; Standard adds detection, UI, and
  combined structured fields; Advanced adds semantic relationships; Full adds
  the reasoner.
- The default Gemini model is `gemini-flash-lite-latest`.
- Gemini per-attempt timeout and overall orchestration budget are separated so
  key fallback can proceed after a timed-out attempt.
- Public final bounding boxes serialize as `{ x1, y1, x2, y2 }` pixel objects.
  Array boxes remain the built-in plugin integration format.
- Documentation now describes Gemini as the built-in general provider rather
  than the only provider, and records REST, URL-input, benchmark,
  and production-audit limitations without claiming production readiness.

### Fixed
- Integration setup now installs and builds the cloned package locally and
  configures clients to run the absolute local MCP entry.
- Directional and near scene-graph edges are bounded to nearest neighbors;
  containment and overlap continue to use all relevant pairs.
- Semantic relation taxonomies now follow effective image type: physical for
  real-world images, UI/document relations for screens and documents, and both
  for mixed images.
- Advanced semantic analysis and Full reasoner work can execute in parallel.
- Gemini OCR and detection share memoized combined analysis within a request.
- Transient Gemini failures use retry/backoff while non-retryable client errors
  fail fast.
- UI/layout entities receive `parentId` from the tightest containing entity.
- Benchmark box matching is category-aware across OCR, object, and UI boxes.
- MCP clipboard, auto-mode, and output-bound documentation now matches the
  implemented behavior.

## [0.1.0] - 2026-07-29

Initial release.

### Added
- Core pipeline: classify → route → orchestrate → normalize → scene graph →
  reasoner → compose, producing unified JSON schema v3.1.0.
- Four processing modes: `basic`, `standard`, `advanced`, `full`.
  VLM only runs in `advanced`/`full` for cost control.
- **Free-first providers (Gemini):** OCR, object detection (with bounding
  boxes), semantic relationships, and reasoning via Google Gemini free tier.
- **Cloud provider:** Gemini for OCR, detection, and VLM analysis.
- **Local providers:** rule-based UI element detection (no API cost),
  mock providers for zero-config testing.
- Image classifier (rule-based) for `real_world` / `screen_ui` / `document` /
  `mixed`.
- Spatial scene graph (geometry, all modes) and semantic scene graph
  (VLM-inferred, constrained to detected entity IDs and a fixed taxonomy).
- Reasoner: summary, UI state interpretation, action hints, anomalies.
- Provider orchestrator with parallel execution, fallback, and a circuit
  breaker.
- Normalization layer: bbox unification, label mapping, duplicate merging.
- In-memory response cache with pluggable `CacheBackend` (Redis-ready).
- Optional Fastify REST server (`vision-skills/server`).
- Security: SSRF protection for URL inputs, magic-byte image validation,
  image resizing to reduce cost.
- SDK + optional server dual entry points.
- 68 unit/integration tests.

### Known limitations
- Provider response parsing is tested with fixtures, not live API calls.
  Verify with a real key before relying on it in production.
- Segmentation, face, and pose plugins are not yet implemented (advanced
  mode runs OCR + detection + UI + VLM).
- Classifier is heuristic; a CLIP-based layer is planned.
