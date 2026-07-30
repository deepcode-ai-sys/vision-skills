/**
 * MCP server for Vision Skills.
 *
 * Exposes vision analysis as MCP tools, so AI assistants (OpenCode, Claude
 * Code, Cursor, etc.) can "see" images without native vision support.
 *
 * Tools:
 *   - analyze(image, mode?, depth?) -> structured JSON
 *   - analyze_text(image, mode?) -> plain-text description (for LLM)
 *   - health() -> provider status
 *
 * Usage:
 *   1. npx vision-skills-mcp
 *   2. Configure in OpenCode's mcp section (see README)
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { VisionSkills } from './index.js';

async function main() {
  // Read all image bytes from stdin until the parent sends the tool call.
  // Simple stdio-based MCP server using raw JSON-RPC.
  const encoder = new TextEncoder();
  const write = (msg: unknown) => {
    const line = JSON.stringify(msg) + '\n';
    process.stdout.write(encoder.encode(line));
  };

  // Minimal MCP server loop (JSON-RPC over stdio).
  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += chunk.toString();
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);

      if (!line.trim()) continue;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // skip malformed lines
      }

      const method = msg.method as string;

      if (method === 'initialize') {
        write({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {
                clipboard: {
                  description: 'Read an image from the system clipboard and return its base64 data. Call this first when the user mentions an image but has not provided a file path.',
                  inputSchema: { type: 'object', properties: {} },
                },
                analyze: {
                  description: 'Analyze an image and return structured JSON',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      image: { type: 'string', description: 'Image path, URL, or base64 data URI' },
                      mode: { type: 'string', enum: ['basic', 'standard', 'advanced', 'full'], default: 'standard' },
                      depth: { type: 'string', enum: ['fast', 'deep'], default: 'fast' },
                    },
                    required: ['image'],
                  },
                },
                analyze_text: {
                  description: 'Analyze an image and return a plain-text summary (good for feeding to text-only LLMs)',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      image: { type: 'string', description: 'Image path, URL, or base64 data URI' },
                      mode: { type: 'string', enum: ['basic', 'standard', 'advanced', 'full'], default: 'standard' },
                    },
                    required: ['image'],
                  },
                },
                health: {
                  description: 'Check provider health',
                  inputSchema: { type: 'object', properties: {} },
                },
              },
            },
            serverInfo: { name: 'vision-skills-mcp', version: '0.1.0' },
          },
        });
        continue;
      }

      if (method === 'notifications/initialized') {
        continue;
      }

      if (method === 'tools/call') {
        const params = msg.params as Record<string, unknown> | undefined;
        const name = params?.name as string;
        const args = (params?.arguments ?? {}) as Record<string, unknown>;

        try {
          const vision = new VisionSkills();
          let result: string;

          if (name === 'health') {
            const health = await vision.healthCheck();
            result = JSON.stringify(health, null, 2);
          } else if (name === 'clipboard') {
            // Read image from system clipboard (Windows)
            const isWin = process.platform === 'win32';
            let b64 = '';
            if (isWin) {
              const psCommand = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
  $ms = New-Object System.IO.MemoryStream
  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $b64 = [System.Convert]::ToBase64String($ms.ToArray())
  Write-Output "DATA:$b64"
} else {
  Write-Output "ERROR:No image in clipboard"
}`;
              const output = execSync(
                `powershell -NoProfile -Command "${psCommand.replace('"', '\\"').replace('\n', ';')}"`,
                { timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
              ).trim();

              if (output.startsWith('DATA:')) {
                b64 = output.slice(5).trim();
              } else {
                throw new Error(output.replace('ERROR:', ''));
              }
            } else {
              // macOS: use osascript or sips
              try {
                const out = execSync(
                  `osascript -e 'try' -e 'set theImage to the clipboard as «class PNGf»' -e 'set thePath to (path to temporary folder as text) & "vskill_clipboard.png"' -e 'set fileRef to open for access file thePath with write permission' -e 'write theImage to fileRef' -e 'close access fileRef' -e 'end try' 2>/dev/null; base64 < /tmp/vskill_clipboard.png 2>/dev/null || echo "ERROR:No image"`,
                  { timeout: 10000, encoding: 'utf8' },
                ).trim();
                if (out && !out.startsWith('ERROR')) b64 = out;
                else throw new Error('No image found in clipboard');
              } catch {
                throw new Error('Clipboard not supported on this platform. Save the image to a file and use analyze() instead.');
              }
            }

            result = JSON.stringify({ base64: `data:image/png;base64,${b64}`, format: 'png' }, null, 2);
          } else if (name === 'analyze' || name === 'analyze_text') {
            const imageArg = args.image as string;
            if (!imageArg) throw new Error('Missing required "image" argument');

            // Accept: URL, data URI, file path, or raw base64
            let imageInput: string | Buffer;
            if (imageArg.startsWith('http://') || imageArg.startsWith('https://') || imageArg.startsWith('data:')) {
              imageInput = imageArg;
            } else {
              // Check if it's a file that exists; otherwise treat as raw base64
              try {
                imageInput = readFileSync(imageArg);
              } catch {
                // Not a valid file path — assume raw base64
                imageInput = Buffer.from(imageArg, 'base64');
              }
            }

            const mode = (args.mode as string) ?? 'standard';
            const depth = (args.depth as string) ?? 'fast';

            // Create a one-off config with the requested depth
            const v = new VisionSkills({
              geminiApiKey: process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS?.split(',')[0],
              analysisDepth: depth as 'fast' | 'deep',
            });

            const res = await v.analyze(imageInput, { mode: mode as never });

            if (name === 'analyze_text') {
              // Convert JSON to plain text for text-only LLMs
              const texts = res.entities
                .filter((e) => e.text)
                .map((e) => e.text)
                .join(' | ');
              const objects = [...new Set(res.entities.map((e) => e.label))].join(', ');
              result = [
                `Image type: ${res.imageType}`,
                texts ? `Text: ${texts}` : null,
                objects ? `Objects: ${objects}` : null,
                res.reasonerOutput ? `Summary: ${res.reasonerOutput.summary}` : null,
              ]
                .filter(Boolean)
                .join('\n');
            } else {
              result = JSON.stringify(res, null, 2);
            }
          } else {
            throw new Error(`Unknown tool: ${name}`);
          }

          write({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text: result }],
            },
          });
        } catch (err) {
          write({
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: -1,
              message: (err as Error).message || String(err),
            },
          });
        }
        continue;
      }

      if (method === 'shutdown') {
        write({ jsonrpc: '2.0', id: msg.id, result: null });
        process.exit(0);
      }
    }
  }
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
