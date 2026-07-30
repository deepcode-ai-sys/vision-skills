---
name: vision-skills
description: "Use when the user asks you to analyze, describe, read, or extract text from an image, screenshot, photo, document, or UI screenshot. Also use when they mention 'vision', 'see this image', 'OCR', 'read this picture', 'what's in this image', or 'analyze this screenshot'. Do NOT trigger on unrelated file operations (code editing, system commands, etc.)."
---

# Vision Skills

You have MCP tools available to analyze images. When the user asks about an image, call the appropriate tool. The tool reads the image, extracts structured data via Gemini, and returns it as JSON. You read the JSON and answer the user — no need to process image pixels yourself.

```
User: "What's in this image?"
  → Call MCP tool: analyze("/path/to/image.jpg")
  → Tool returns JSON with text, objects, tables, colors, relationships
  → You read the JSON and answer the user
```

## Available tools

| Tool | Description |
|------|-------------|
| `analyze(image, mode?, depth?)` | Return full structured JSON |
| `analyze_text(image, mode?)` | Return plain-text summary (easier for LLMs to consume) |
| `health()` | Check if API is configured correctly |

### Parameters

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `image` | file path, URL, or base64 | required | The image to analyze |
| `mode` | `basic`, `standard`, `advanced`, `full` | `standard` | Trade detail for speed/cost |
| `depth` | `fast`, `deep` | `fast` | `deep` tiles large images for thorough reading |

### Output includes

- **Text blocks** — every visible text with position
- **Object labels** — detected objects with bounding boxes
- **Tables** — structured rows/columns from dashboards, invoices, logs
- **Code context** — language, function names, errors (if showing code)
- **Text attributes** — color and emphasis (heading, error, muted, link...)
- **Scene graph** — spatial relationships (left_of, contains, near...)
- **UI hierarchy** — containment tree
- **Semantic relationships** — part_of, labels, controls (advanced+)
- **Reasoning** — summary, UI state, action hints (advanced+)
