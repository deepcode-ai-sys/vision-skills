# Contributing to Vision Skills

Vision Skills turns images into structured JSON through a provider-agnostic pipeline. Gemini is the built-in general provider; local or remote specialists are explicit HTTP integrations rather than bundled models.

## Development Setup

Use Node.js >=20.18.

```bash
git clone https://github.com/deepcode-ai-sys/vision-skills.git
cd vision-skills
npm ci
npm run typecheck
npm run lint
npm run build
npm test
npm run benchmark:mock
npm pack --dry-run
```

CI runs these checks on Node 20.18, 22, and 24. Tests and the mock benchmark must not require live provider credentials.

## Project Structure

```text
src/
|-- benchmark/      metric implementations
|-- cache/          injectable response cache
|-- core/           types, errors, classifier, router, orchestrator
|-- normalizers/    built-in plugin output to unified entities
|-- plugins/        Gemini, local UI, mock, and plugin base classes
|-- reasoner/       full-mode VLM reasoning
|-- scene-graph/    spatial and semantic relationships
|-- server/         optional hardened Fastify REST adapter
|-- specialists/    explicit HTTP routes, codecs, and composition
`-- utils/          image security/preprocessing and output bounds
```

## Contracts

Preserve the enforced mode policies:

| Mode | Policy |
| --- | --- |
| `basic` | OCR only |
| `standard` | OCR + detection + UI + combined structured fields |
| `advanced` | Standard + semantic relationships, without reasoner |
| `full` | Advanced + reasoner |

SDK `auto` is a real requested mode and must remain distinguishable in provenance. Do not silently map it to `standard`; uncertain classifications may select `standard`, while simple documents may select `basic`.

The mode table governs both the built-in plugin pipeline and explicit specialist routes. `basic` permits only OCR specialists; all declared specialist capabilities are eligible in `standard`, `advanced`, and `full`.

Final `Entity`, `Table`, and `Region` boxes use `BoundingBox` and serialize as `{ x1, y1, x2, y2 }` pixel objects. Built-in plugin payloads and specialist canonical payloads use `[x1, y1, x2, y2]` arrays at their boundaries.

Do not invent confidence. Specialist canonical confidence is `number | null`; unavailable values remain `null`. Top-level request confidence, entity confidence, and reasoner confidence have different semantics and must not be conflated.

## Adding a Built-In Plugin

1. Extend `BasePlugin` under `src/plugins/<type>/`.
2. Implement `run()` and `healthCheck()`.
3. Return the normalizer boundary shape: `text_blocks`, `objects`, `ui_elements`, or `regions`, with array-form pixel boxes.
4. Register the plugin in `src/vision-skills.ts` or document user registration through `registerPlugin()`.
5. Add fixture-based parser, fallback, error, and cancellation tests as applicable.

See `examples/custom-plugin.ts`. Keep provider-specific parsing out of core routing and normalization.

## Adding a Specialist Protocol

Specialist providers are explicit configured HTTP services. When adding a protocol:

1. Add its exact name and types in `src/specialists/types.ts`.
2. Implement strict request encoding and response decoding in `src/specialists/codecs.ts`.
3. Convert output to canonical-v1 semantics without fabricating missing fields or confidence.
4. Validate malformed, oversized, timed-out, cancelled, redirected, and non-2xx responses.
5. Add committed fixtures from documented response shapes, not live calls.
6. Document whether routes augment or replace built-in output and which capabilities are supported.

Provider declarations do not activate routing. Every capability requires an explicit ordered route with `augment` or `replace`. Fallback must remain confined to that chain, and exhausted routes must fail visibly.

## Documentation and Benchmark Claims

- Do not describe the package as Gemini-only or cloud-only.
- Do not claim live specialist accuracy from codec fixtures or the deterministic mock benchmark.
- `benchmark:mock` validates metrics/report plumbing using committed canonical data; its perfect values are not model measurements.
- Local/live results must record runner code, data provenance, provider/model version, endpoint configuration, and environment. Never commit keys or sensitive images.
- Describe security controls with their limits, including the unpinned-DNS caveat for image URLs and the trusted-configuration boundary for specialist endpoints.
- Do not claim full production readiness without an independent audit, representative live accuracy evaluation, load testing, and operational evidence.

## Pull Requests

Keep changes focused, add tests for behavior, update `CHANGELOG.md` under `Unreleased`, and run the full check sequence above. Version bumps belong to an intentional release and should update package metadata and release notes together.

Bug reports should include reproduction steps, expected and actual behavior, Node version, mode, provider/protocol, and sanitized errors. Never include API keys or sensitive image content.
