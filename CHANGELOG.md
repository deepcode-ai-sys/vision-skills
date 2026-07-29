# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **Semantic relations are now image-type aware.** Real-world images use
  physical relations (holding, wearing...); UI/document images use UI
  relations (contains, part_of, labels, controls, submits...). Previously a
  button was reported as "holding" its label text — now correctly "part_of" /
  "labels". Verified live.
- **Classifier accuracy improved** by reusing Gemini's own image-type
  classification (returned in the same combined call — no extra API cost).
  A login screenshot that was misclassified as `mixed` is now correctly
  `screen_ui`. Verified live.
- **Advanced/Full mode ~2x faster.** Semantic graph and reasoner now run in
  parallel instead of sequentially (39s -> ~20s on the test image).
- **Default Gemini model updated** from `gemini-2.0-flash` (returns 429 /
  restricted on current free tier) to `gemini-2.5-flash`, verified working
  end-to-end against the live API.
- **Increased Gemini plugin timeout** to 30s. `gemini-2.5-flash` uses
  reasoning and can take 10-20s per call, which exceeded the previous 8s
  default and caused spurious timeouts.
- Verified end-to-end with a real API key: OCR (incl. Vietnamese), object
  detection with bounding boxes, and combined single-call behavior all work.

### Changed
- **Gemini calls combined.** OCR and object detection now share a single
  Gemini API call per request (memoized per request context) instead of two
  separate calls — roughly halves token cost and rate-limit pressure for
  `standard`+ modes.
- **Gemini client now retries transient failures** (429/5xx and network
  errors) with exponential backoff + jitter, honoring the `Retry-After`
  header. Client errors (4xx except 429) fail fast. Configurable via `retry`.
- **Smarter classifier confidence.** Confidence is now margin-based (winner
  vs runner-up), so ambiguous images get lower confidence and fall back to
  `mixed`/Standard mode. Added brightness + color-variety signals to better
  separate documents, UI, and photos.

### Added
- UI/layout hierarchy: entities now get a `parentId` set to the tightest
  containing entity (`SpatialGraphBuilder.assignHierarchy`).

## [0.1.0] - 2026-07-29

Initial release.

### Added
- Core pipeline: classify → route → orchestrate → normalize → scene graph →
  reasoner → compose, producing unified JSON schema v3.1.0.
- Four processing modes: `basic`, `standard`, `advanced`, `full`.
  VLM only runs in `advanced`/`full` for cost control.
- **Free-first providers (Gemini):** OCR, object detection (with bounding
  boxes), semantic relationships, and reasoning via Google Gemini free tier.
- **Paid provider alternatives:** Google Cloud Vision (OCR + detection),
  Anthropic Claude (VLM).
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
- 37 unit/integration tests.

### Known limitations
- Provider response parsing is tested with fixtures, not live API calls.
  Verify with a real key before relying on it in production.
- Segmentation, face, and pose plugins are not yet implemented (advanced
  mode runs OCR + detection + UI + VLM).
- Classifier is heuristic; a CLIP-based layer is planned.
