---
name: vision-skills
description: "Use when the user asks you to analyze, describe, read, or extract text from an image, screenshot, photo, document, or UI screenshot. Also use when they mention 'vision', 'see this image', 'OCR', 'read this picture', 'what's in this image', or 'analyze this screenshot'. Do NOT trigger on unrelated file operations (code editing, system commands, etc.)."
---

# Vision Skills

Use the registered `vision-skills` MCP tools directly when the user provides or refers to an image. Do not start another server or manually send JSON-RPC through the shell. If the tools are unavailable, state that the MCP integration is not connected, ask the user to run `setup-integrations.bat` on Windows or `setup-integrations.sh` on macOS/Linux from the repository root, and have them restart the client. The setup installs dependencies, builds locally, and configures the client to run the clone's absolute MCP entry path.

## Tools

| Tool | Inputs | Result |
| --- | --- | --- |
| `analyze` | `image`, optional `auto` or fixed `mode`, optional `depth` | Bounded structured vision response |
| `analyze_text` | `image`, optional `auto` or fixed `mode` | Bounded plain-text summary |
| `health` | None | Provider readiness |
| `clipboard` | None; Windows only | Official MCP PNG image content from the system clipboard |

`image` accepts a file path, HTTP(S) URL, base64 string, or image data URI. When the user asks about an image currently on the Windows clipboard, call `clipboard` and analyze the returned MCP image content directly. If the client cannot expose that content to the model, the client must mediate a subsequent analysis call; the tool does not return a data URI.

## Mode Policy

MCP analysis accepts `auto` and fixed modes. Omitting `mode` inherits the configured SDK default, which is `auto` unless changed.

| Mode | Exact policy |
| --- | --- |
| `basic` | OCR only; no combined structured fields, semantic relationships, or reasoner |
| `standard` | OCR + object + UI detection and combined tables/regions/layout/code fields; no semantic relationships or reasoner |
| `advanced` | Standard plus semantic relationships; no reasoner |
| `full` | Advanced plus reasoner |

Choose `basic` for quick text extraction, `standard` for normal screenshots/documents/photos, `advanced` when relationships matter, and `full` only when a reasoned interpretation is needed. Use `depth: deep` for dense or long images with small text; it creates additional tiled provider calls. Otherwise keep `fast`.

## Reading Results

- Final bounding boxes are pixel objects: `{ x1, y1, x2, y2 }`.
- `entity.confidence: null` means the provider did not report confidence; do not invent a score.
- Top-level `confidence` is an aggregate provider signal, not calibrated end-to-end accuracy.
- Use `provenance` to identify the requested mode, selection reason, provider names, and cache hits.
- Treat `errors`, `warnings`, `reasonerOutput.openQuestions`, and output `truncation` as material caveats.

MCP output is wrapped with `truncation` metadata. Read untruncated structured data from `data`. If `truncation.truncated` is true, `json` contains a bounded partial serialization and must not be presented as complete analysis.

Cancellation and progress are protocol features: let the client cancel long calls, and expect progress only when it supplied a progress token.

## URL Safety

Image URL checks block redirects, explicit ports, credentials, and non-public resolved addresses, but DNS is not pinned to the connection. For untrusted URLs, acknowledge the DNS rebinding/time-of-check caveat rather than describing URL fetching as a complete SSRF sandbox.
