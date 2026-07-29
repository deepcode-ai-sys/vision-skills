# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
