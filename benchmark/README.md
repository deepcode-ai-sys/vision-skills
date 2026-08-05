# Benchmark

`npm run benchmark:mock` is a deterministic end-to-end smoke test of benchmark and package plumbing. It builds the package, generates a small image from fixture metadata, runs the public `VisionSkills` pipeline through the built-in mock providers, then derives OCR and box metrics from the actual response. It writes ignored output to `benchmark/results/mock.json`. `npm run chart:benchmark` additionally renders `benchmark/benchmark-chart.svg` from that JSON for the README.

Reported metrics are character error rate (CER), word error rate (WER), category-aware maximum-cardinality IoU box precision/recall/F1, and p50/p95 pipeline latency. Expected and predicted boxes are labeled `ocr`, `object`, or `ui` and can match only within the same category. The mock providers are deterministic, so perfect accuracy values validate plumbing and do not measure any provider or model. The latency is local pipeline overhead, not inference latency.

`manifest.json` and `manifest.schema.json` define this small tranche. The fixture contains generated metadata, not a user image. Benchmark boxes use `[x1, y1, x2, y2]` pixel arrays; final public responses serialize `BoundingBox` values as objects.

The package does not include nonfunctional local/live scripts. A meaningful external runner must provide representative images, independently prepared expected data, endpoint credentials, provider/model and environment versions, warmup policy, and repeated latency measurements.

No mock result supports a claim about Gemini or production accuracy. Publish live numbers only when they come from a reproducible live profile, never from parser fixtures or this mock profile.
