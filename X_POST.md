Vision Skills is now open source. It translates images into structured JSON for text-only language models that cannot process visual inputs natively.

The core mechanism is straightforward: an MCP tool receives an image, extracts objects, text, tables, code, spatial relationships, and semantic context via the Gemini free tier, and returns the result as structured data. The calling model reads the JSON — it never needs to interpret pixels directly.

Supported integrations include OpenCode, Claude Code CLI, Cursor, Continue, GitHub Copilot, VS Code, Cline, Roo, Kilo Code, OpenAI Codex CLI, and 9Router. Available as an MCP server, CLI, REST API, or SDK.

Key capabilities:
- Single-pass and tiled deep reading (40-95 vs 140-210 text blocks on dense screenshots)
- Table extraction with column/row structure
- Code context detection (language, functions, errors)
- Text styling attributes (color, emphasis)
- Multi-key rotation to stay within free-tier rate limits
- Spatial scene graph with containment hierarchy
- Semantic reasoning and UI state analysis

Setup requires one Gemini API key (free, no credit card) and one configuration file per tool. Automated setup scripts are included for Windows (.bat) and macOS/Linux (.sh).

https://github.com/deepcode-ai-sys/vision-skills

#opensource #vision #llm #mcp #gemini #typescript #nodejs #ocr #aidevelopment #machinelearning #computervision #devtools #programming #github #artificialintelligence #softwareengineering #naturallanguageprocessing #multimodal #aimodels #genai #oss
