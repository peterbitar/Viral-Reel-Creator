import { db } from "../../db/db.js";
import { initSchema } from "../../db/schema.js";
import { llmJson } from "../../llm/client.js";
import { loadConfig } from "../../config/loader.js";

initSchema();

export async function processGenCaptionsJob(variantId: number): Promise<void> {
  // Verify variant exists
  const variant = db
    .prepare("SELECT id FROM variants WHERE id = ?")
    .get(variantId) as { id: number } | undefined;

  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  const config = await loadConfig();
  const prompt = `Write ${config.captions_per_variant} engaging, natural captions (1-2 lines max) for a TikTok/Instagram Reel showing a close-up of a cat eating a treat.

Requirements:
- Sound like a real person sharing something cool, NOT a brand or ad
- Be conversational and authentic
- Create emotional connection (cute, satisfying, relatable)
- Use natural speech patterns and casual language
- Vary the tone: some funny, some wholesome, some relatable
- NO hashtags, NO emojis, NO marketing speak
- Keep it short and punchy (1-2 lines max)

Examples of GOOD captions:
- "When your cat makes the most satisfying crunch sound"
- "I could watch this all day"
- "The way she looks at the camera mid-crunch"
- "This is peak satisfaction"
- "Why is watching animals eat so calming"

Return JSON with a single field "captions" containing an array of ${config.captions_per_variant} unique caption strings. Format: {"captions": ["caption1", "caption2", ...]}`;

  console.log(`[GEN_CAPTIONS] Generating captions for variant_id=${variantId}...`);

  const response = await llmJson(prompt);
  const captions = response.captions || [];

  if (!Array.isArray(captions) || captions.length === 0) {
    console.warn(`[GEN_CAPTIONS] No captions returned for variant_id=${variantId}`);
    return;
  }

  const insertStmt = db.prepare(
    "INSERT INTO captions (variant_id, caption_text) VALUES (?, ?)"
  );

  for (const caption of captions) {
    if (typeof caption === "string" && caption.trim().length > 0) {
      insertStmt.run(variantId, caption.trim());
    }
  }

  console.log(`[GEN_CAPTIONS] Inserted ${captions.length} captions for variant_id=${variantId}`);
}

