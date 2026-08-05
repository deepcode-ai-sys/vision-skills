# Specialist Benchmark

`npm run benchmark:mock` is a deterministic end-to-end smoke test of benchmark and package plumbing. It builds the package, generates a small image from fixture metadata, starts a loopback canonical-v1 HTTP provider, runs the public `VisionSkills` pipeline through routing, HTTP encoding/decoding, replacement composition, and response packaging, then derives route, call, OCR, and box metrics from the actual response. It writes ignored output to `benchmark/results/mock.json`.

Reported metrics are character error rate (CER), word error rate (WER), category-aware maximum-cardinality IoU box precision/recall/F1, observed routing accuracy, observed HTTP call count, and p50/p95 pipeline latency. Expected and predicted boxes are labeled `ocr`, `object`, or `ui` and can match only within the same category. The deterministic provider is generated code, so perfect accuracy values validate plumbing and do not measure any provider or model. The latency is local pipeline overhead, not inference latency.

`manifest.json` and `manifest.schema.json` define this small tranche. The fixture contains generated metadata, not a user image. Canonical benchmark boxes use `[x1, y1, x2, y2]` pixel arrays; final public responses serialize `BoundingBox` values as objects.

The package does not include nonfunctional local/live scripts. A meaningful external runner must provide representative images, independently prepared expected data, endpoint credentials, provider/model and environment versions, warmup policy, and repeated latency measurements.

No mock result supports a claim about Gemini, PaddleOCR, Docling, OmniParser, OpenAI-compatible VLM, route quality, or production accuracy. Publish live specialist numbers only when they come from a reproducible live profile, never from parser fixtures or this mock profile.

Specialist providers remain opt-in HTTP services. Every capability needs an explicit ordered route with `augment` or `replace`; failures advance only through that chain. Supported protocols are `canonical-v1`, `paddleocr-classic`, `docling-json`, `omniparser-v2`, and `openai-chat-completions`. See the root package `README.md` for configuration and trust boundaries.
