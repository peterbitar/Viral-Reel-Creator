import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";
import { llmJson } from "./client.js";

initSchema();

async function generateCaptions(variantId: number): Promise<void> {
  // Verify variant exists
  const variant = db
    .prepare("SELECT id FROM variants WHERE id = ?")
    .get(variantId) as { id: number } | undefined;

  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  const prompt = `Write 3 short captions (1–2 lines) for a TikTok/IG Reel showing a cat eating a treat. Must feel casual, not like an ad. No hashtags. Return JSON with a single field "captions" containing an array of strings. Example: {"captions": ["This is so cute!", "Watch this", "You have to see this"]}`;

  console.log(`[CAPTIONS] Generating captions for variant_id=${variantId}...`);

  try {
    const response = await llmJson(prompt);
    const captions = response.captions || [];

    if (!Array.isArray(captions) || captions.length === 0) {
      throw new Error("LLM did not return a valid captions array");
    }

    const insertStmt = db.prepare(
      "INSERT INTO captions (variant_id, caption_text) VALUES (?, ?)"
    );

    for (const caption of captions) {
      if (typeof caption === "string" && caption.trim().length > 0) {
        insertStmt.run(variantId, caption.trim());
      }
    }

    console.log(
      `[CAPTIONS] Inserted ${captions.length} captions for variant_id=${variantId}`
    );
  } catch (error) {
    console.error(`[CAPTIONS] Error generating captions:`, error);
    throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let variantId: number | null = null;

  for (const arg of args) {
    if (arg.startsWith("--variant_id=")) {
      variantId = parseInt(arg.split("=")[1], 10);
      break;
    } else if (arg === "--variant_id" && args[args.indexOf(arg) + 1]) {
      variantId = parseInt(args[args.indexOf(arg) + 1], 10);
      break;
    }
  }

  if (!variantId || isNaN(variantId)) {
    console.error("[CAPTIONS] Usage: npm run captions -- --variant_id=<id>");
    process.exit(1);
  }

  await generateCaptions(variantId);
}

main().catch(console.error);


