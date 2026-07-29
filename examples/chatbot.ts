/**
 * Example: Give a text-only LLM the ability to "see" images.
 *
 * Vision Skills turns an image into structured JSON, which you convert into
 * text and feed to any text-only model (DeepSeek, Llama, Mimo, GPT-3.5...).
 *
 * Run: GEMINI_API_KEY=... npx tsx examples/chatbot.ts ./some-image.jpg
 */

import { VisionSkills, type VisionResponse } from 'vision-skills';

// 1. Initialize (free Gemini tier)
const vision = new VisionSkills({
  geminiApiKey: process.env.GEMINI_API_KEY,
  // no key? use: useMockProviders: true
});

/** Convert the structured JSON into a plain-text description for an LLM. */
function toLLMContext(result: VisionResponse): string {
  const texts = result.entities
    .filter((e) => e.text)
    .map((e) => e.text)
    .join(' | ');

  const objects = [...new Set(result.entities.map((e) => e.label))].join(', ');

  const relations = result.sceneGraph.spatial
    .slice(0, 10)
    .map((r) => `${r.subjectId} ${r.relation} ${r.objectId}`)
    .join('; ');

  return [
    `Image type: ${result.imageType}`,
    texts ? `Text in image: ${texts}` : null,
    objects ? `Objects detected: ${objects}` : null,
    relations ? `Spatial layout: ${relations}` : null,
    result.reasonerOutput ? `Summary: ${result.reasonerOutput.summary}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pretend this is your text-only LLM. */
async function yourTextOnlyLLM(prompt: string): Promise<string> {
  // Replace with a real call to DeepSeek / Llama / etc.
  return `(LLM would answer based on:)\n${prompt}`;
}

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error('Usage: npx tsx examples/chatbot.ts <image-path>');
    process.exit(1);
  }

  // 2. Analyze the image
  const result = await vision.analyze(imagePath, { mode: 'standard' });

  // 3. Turn JSON into text context
  const context = toLLMContext(result);
  console.log('--- Context given to the text-only LLM ---');
  console.log(context);

  // 4. Feed to your text-only model
  const userQuestion = 'What is in this image?';
  const answer = await yourTextOnlyLLM(
    `You are a helpful assistant. The user sent an image.\n${context}\n\nUser: ${userQuestion}`,
  );

  console.log('\n--- LLM answer ---');
  console.log(answer);
}

main().catch(console.error);
