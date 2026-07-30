---
name: vision-skills
description: "Use when the user asks you to analyze, describe, read, or extract text from an image, screenshot, photo, document, or UI screenshot. Also use when they mention 'vision', 'see this image', 'OCR', 'read this picture', 'what's in this image', or 'analyze this screenshot'. Do NOT trigger on unrelated file operations (code editing, system commands, etc.)."
---

# Vision Skills

You have access to a vision analysis MCP server. When the user provides an image, find the server file and call it via bash using JSON-RPC over stdin/stdout.

## How to find the server

The MCP server binary is registered in the OpenCode config. Read the config to find it:
```
Read opencode.json → find mcp.vision-skills.command
→ Contains ["node", "/path/to/mcp-server.js"]
→ Use that path
```

If not found, search for `mcp-server.js` in common locations or ask the user.

## How to call

```
1. Initialize:
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize"...}' | node /path/to/mcp-server.js

2. Analyze:
   echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"analyze","arguments":{"image":"path.jpg"}}}' | node /path/to/mcp-server.js
```

## Available tools

| Tool | Description |
|------|-------------|
| `clipboard()` | Read image from system clipboard → returns base64 |
| `analyze(image, mode?, depth?)` | Analyze image → full structured JSON |
| `analyze_text(image, mode?)` | Analyze image → plain-text summary |
| `health()` | Check if API is configured |

### analyze() output includes

- Text blocks (with position, color, emphasis)
- Object labels (with bounding boxes)
- Tables (structured rows/columns)
- Code context (language, functions, errors)
- Scene graph (spatial relationships)
- UI hierarchy (containment tree)
- Semantic relationships (advanced+)
- Reasoning (advanced+)

### Parameters

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `image` | file path, URL, base64, `clipboard://` | required | The image to analyze |
| `mode` | `basic`, `standard`, `advanced`, `full` | `standard` | Trade detail for cost |
| `depth` | `fast`, `deep` | `fast` | `deep` tiles large images for thorough reading |
