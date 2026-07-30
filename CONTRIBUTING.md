# Contributing to Vision Skills

Thanks for your interest in contributing. This project turns images into
structured JSON for text-only AI models, using a plugin-based, cloud-only
architecture.

## Development setup

```bash
git clone https://github.com/deepcode-ai-sys/vision-skills.git
cd vision-skills
npm install
npm run build
npm test
```

## Scripts

- `npm run build` â€” compile TypeScript to `dist/`
- `npm test` â€” run the test suite (vitest)
- `npm run typecheck` â€” type-check without emitting
- `npm run lint` â€” lint with ESLint

## Project structure

```
src/
â”œâ”€â”€ core/          types, errors, classifier, router, orchestrator
â”œâ”€â”€ plugins/       provider plugins (gemini, google-vision, ui, mock)
â”œâ”€â”€ normalizers/   unify provider outputs into entities
â”œâ”€â”€ scene-graph/   spatial (geometry) + semantic (VLM) relationships
â”œâ”€â”€ reasoner/      VLM-based reasoning (advanced/full modes)
â”œâ”€â”€ cache/         response caching
â”œâ”€â”€ utils/         image loading/preprocessing
â””â”€â”€ server/        optional Fastify REST server
```

## Adding a new provider

Providers are plugins. To add one:

1. Create a class in `src/plugins/<type>/<provider>.ts` extending `BasePlugin`.
2. Implement `run()` returning data in the normalizer's expected shape:
   - OCR: `{ confidence, text_blocks: [{ text, bbox, confidence, language }] }`
   - Detection: `{ confidence, objects: [{ label, bbox, confidence }] }`
   - UI: `{ confidence, ui_elements: [{ label, element_type, bbox, confidence }] }`
   - `bbox` is always `[x1, y1, x2, y2]` in pixel coordinates.
3. Implement `healthCheck()`.
4. Register it in `src/vision-skills.ts` (or let users call `registerPlugin`).
5. Add unit tests for the response parsing (see `test/gemini.test.ts`).

See `examples/custom-plugin.ts` for a working example.

## Guidelines

- Keep the core provider-agnostic. Provider specifics stay in plugins.
- All outputs must conform to the unified schema (v3.1.0).
- Prefer free/local options as defaults where quality allows.
- Add tests for parsing logic â€” do not rely on live API calls in CI.
- Run `npm run lint && npm run typecheck && npm test` before opening a PR.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, Node
version, and (if relevant) which provider/mode you used. Never include API
keys or sensitive images.
