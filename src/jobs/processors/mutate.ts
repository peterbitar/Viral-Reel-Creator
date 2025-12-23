import path from "path";
import fs from "fs/promises";
import { db } from "../../db/db.js";
import { initSchema } from "../../db/schema.js";
import { llmJson } from "../../llm/client.js";
import { renderTextOverlay } from "../../media/ffmpeg.js";
import { enqueueJob } from "../queue.js";

initSchema();

export async function processMutateJob(variantId: number): Promise<void> {
  // Get winner variant with its hook and clip
  const winner = db
    .prepare(
      `SELECT v.id as variant_id, v.clip_id, v.generation, h.id as hook_id, h.hook_text, c.filepath_clip
       FROM variants v
       JOIN hooks h ON v.hook_id = h.id
       JOIN clips c ON v.clip_id = c.id
       WHERE v.id = ?`
    )
    .get(variantId) as {
    variant_id: number;
    clip_id: number;
    generation: number;
    hook_id: number;
    hook_text: string;
    filepath_clip: string;
  } | undefined;

  if (!winner) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  const newGeneration = winner.generation + 1;

  console.log(
    `[MUTATE] Mutating variant_id=${variantId} (generation ${winner.generation} -> ${newGeneration}), hook: "${winner.hook_text}"`
  );

      // Generate maximum 4 hook variations (but typically 3)
      const prompt = `Given this successful hook: "${winner.hook_text}"

Generate the TOP 3-4 EVEN STRONGER variations (3-6 words each) that build on what made this hook successful.

Requirements:
- Make them MORE engaging and curiosity-driven than the original
- Increase sensory language and emotional impact
- Keep the essence but make it punchier
- Use vivid, specific language
- NO emojis, NO health claims
- Each should feel fresh and unique

Examples of evolution:
Original: "Watch this" → Better: "Wait for the sound"
Original: "So cute" → Better: "That look gets me"
Original: "Satisfying" → Better: "This crunch is everything"

Return JSON with a single field "hooks" containing exactly 3 strings. Format: {"hooks": ["variation1", "variation2", "variation3"]}`;

  const response = await llmJson(prompt);
  const newHooks = response.hooks || [];

  if (!Array.isArray(newHooks) || newHooks.length === 0) {
    console.warn(`[MUTATE] Failed to generate hooks for variant_id=${variantId}`);
    return;
  }

  // Verify clip file exists
  try {
    await fs.access(winner.filepath_clip);
  } catch {
    throw new Error(`Clip file not found: ${winner.filepath_clip}`);
  }

  const insertHookStmt = db.prepare(
    "INSERT INTO hooks (clip_id, hook_text, hook_style, generation, parent_hook_id, source) VALUES (?, ?, 'auto', ?, ?, 'mutated')"
  );

  const insertVariantStmt = db.prepare(
    "INSERT INTO variants (clip_id, hook_id, filepath_variant, overlay_style, status, generation, parent_variant_id) VALUES (?, ?, ?, 'bottom_center_white_black_stroke_wrapped', 'generated', ?, ?)"
  );

  const variantsDir = path.join(process.cwd(), "working", "variants");
  await fs.mkdir(variantsDir, { recursive: true });

  for (const hookText of newHooks.slice(0, 3)) {
    if (typeof hookText !== "string" || hookText.trim().length === 0) {
      continue;
    }

    try {
      // Insert new hook
      let hookId: number;
      try {
        const hookResult = insertHookStmt.run(
          winner.clip_id,
          hookText.trim(),
          newGeneration,
          winner.hook_id
        );
        hookId = Number(hookResult.lastInsertRowid);
      } catch (error: any) {
        if (error.message && error.message.includes("UNIQUE")) {
          // Hook already exists, get its ID
          const existing = db
            .prepare("SELECT id FROM hooks WHERE clip_id = ? AND hook_text = ?")
            .get(winner.clip_id, hookText.trim()) as { id: number } | undefined;
          if (existing) {
            hookId = existing.id;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      // Render variant
      const variantFilename = `${winner.clip_id}_${hookId}.mp4`;
      const variantPath = path.join(variantsDir, variantFilename);

      try {
          await renderTextOverlay(winner.filepath_clip, variantPath, hookText.trim(), {
            position: "top", // HOOK zone - upper third where hooks go
            fontColor: "white",
            strokeColor: "black",
            strokeWidth: 5,
          });

        // Insert variant
        let newVariantId: number;
        try {
          const variantResult = insertVariantStmt.run(
            winner.clip_id,
            hookId,
            variantPath,
            newGeneration,
            winner.variant_id
          );
          newVariantId = Number(variantResult.lastInsertRowid);

          // Enqueue captions and postpack jobs
          enqueueJob("gen_captions", "variant", newVariantId);
          enqueueJob("postpack", "variant", newVariantId);

          console.log(
            `[MUTATE] Created generation ${newGeneration} variant_id=${newVariantId} with hook "${hookText.trim()}"`
          );
        } catch (error: any) {
          if (error.message && error.message.includes("UNIQUE")) {
            // Variant already exists
            const existing = db
              .prepare(
                "SELECT id FROM variants WHERE clip_id = ? AND hook_id = ? AND overlay_style = ?"
              )
              .get(winner.clip_id, hookId, "bottom_center_white_black_stroke_wrapped") as { id: number } | undefined;
            if (existing) {
              enqueueJob("gen_captions", "variant", existing.id);
              enqueueJob("postpack", "variant", existing.id);
            }
          } else {
            throw error;
          }
        }
      } catch (error) {
        console.error(`[MUTATE] Error rendering variant for hook "${hookText.trim()}":`, error);
      }
    } catch (error) {
      console.error(`[MUTATE] Error processing hook "${hookText.trim()}":`, error);
    }
  }
}

