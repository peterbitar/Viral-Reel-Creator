import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";
import { llmJson } from "./client.js";

initSchema();

async function generateHooks(clipId: number): Promise<void> {
  // Verify clip exists
  const clip = db
    .prepare("SELECT id FROM clips WHERE id = ?")
    .get(clipId) as { id: number } | undefined;

  if (!clip) {
    throw new Error(`Clip not found: ${clipId}`);
  }

  const prompt = `Generate 30 ultra-short hooks (3–6 words). Purpose: maximize curiosity or sensory replay for a close-up cat eating treat video. Avoid emojis. Avoid health claims. Keep language simple. Return JSON with a single field "hooks" containing an array of strings only. Example: {"hooks": ["Watch this", "You won't believe", ...]}`;

  console.log(`[HOOKS] Generating hooks for clip_id=${clipId}...`);

  try {
    const response = await llmJson(prompt);
    const hooks = response.hooks || [];

    if (!Array.isArray(hooks) || hooks.length === 0) {
      throw new Error("LLM did not return a valid hooks array");
    }

    const insertStmt = db.prepare(
      "INSERT INTO hooks (clip_id, hook_text, hook_style) VALUES (?, ?, ?)"
    );

    for (const hook of hooks) {
      if (typeof hook === "string" && hook.trim().length > 0) {
        insertStmt.run(clipId, hook.trim(), "auto");
      }
    }

    console.log(`[HOOKS] Inserted ${hooks.length} hooks for clip_id=${clipId}`);
  } catch (error) {
    console.error(`[HOOKS] Error generating hooks:`, error);
    throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let clipId: number | null = null;

  for (const arg of args) {
    if (arg.startsWith("--clip_id=")) {
      clipId = parseInt(arg.split("=")[1], 10);
      break;
    } else if (arg === "--clip_id" && args[args.indexOf(arg) + 1]) {
      clipId = parseInt(args[args.indexOf(arg) + 1], 10);
      break;
    }
  }

  if (!clipId || isNaN(clipId)) {
    console.error("[HOOKS] Usage: npm run hooks -- --clip_id=<id>");
    process.exit(1);
  }

  await generateHooks(clipId);
}

main().catch(console.error);


