import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";
import { llmJson } from "../llm/client.js";
import { renderTextOverlay } from "../media/ffmpeg.js";
import path from "path";
import fs from "fs/promises";

initSchema();

interface WinnerRow {
  clip_id: number;
  variant_id: number;
  hook_text: string;
  filepath_clip: string;
}

async function mutateWinners(snapshotHours: number = 24): Promise<void> {
  // Get winners with their hook text and clip filepath
  const winners = db
    .prepare(
      `SELECT w.clip_id, w.variant_id, h.hook_text, c.filepath_clip
       FROM winners w
       JOIN variants v ON w.variant_id = v.id
       JOIN hooks h ON v.hook_id = h.id
       JOIN clips c ON v.clip_id = c.id
       WHERE w.snapshot_hours = ?`
    )
    .all(snapshotHours) as WinnerRow[];

  if (winners.length === 0) {
    console.log(
      `[MUTATE] No winners found for snapshot=${snapshotHours}h. Run winner selection first.`
    );
    return;
  }

  console.log(
    `[MUTATE] Mutating ${winners.length} winners for snapshot=${snapshotHours}h...`
  );

  const insertHookStmt = db.prepare(
    "INSERT INTO hooks (clip_id, hook_text, hook_style) VALUES (?, ?, ?)"
  );

  const insertVariantStmt = db.prepare(
    "INSERT INTO variants (clip_id, hook_id, filepath_variant, overlay_style, status) VALUES (?, ?, ?, ?, ?)"
  );

  const variantsDir = path.join(process.cwd(), "working", "variants");
  await fs.mkdir(variantsDir, { recursive: true });

  for (const winner of winners) {
    try {
      // Generate 3 hook rewrites
      const prompt = `Given this hook: "${winner.hook_text}"
Generate 3 shorter and stronger variations (3-6 words each). Purpose: maximize curiosity or sensory replay for a close-up cat eating treat video. Avoid emojis. Avoid health claims. Keep language simple. Return JSON with a single field "hooks" containing an array of 3 strings. Example: {"hooks": ["Watch this", "You won't believe", "Incredible moment"]}`;

      console.log(
        `[MUTATE] Generating mutations for clip_id=${winner.clip_id}, original hook: "${winner.hook_text}"`
      );

      const response = await llmJson(prompt);
      const newHooks = response.hooks || [];

      if (!Array.isArray(newHooks) || newHooks.length === 0) {
        console.warn(
          `[MUTATE] Failed to generate hooks for variant_id=${winner.variant_id}`
        );
        continue;
      }

      // Verify clip file exists
      try {
        await fs.access(winner.filepath_clip);
      } catch {
        console.warn(
          `[MUTATE] Clip file not found: ${winner.filepath_clip}, skipping`
        );
        continue;
      }

      // Insert new hooks and render variants
      for (const hookText of newHooks.slice(0, 3)) {
        if (typeof hookText !== "string" || hookText.trim().length === 0) {
          continue;
        }

        const hookResult = insertHookStmt.run(
          winner.clip_id,
          hookText.trim(),
          "mutated"
        );
        const hookId = Number(hookResult.lastInsertRowid);

        // Render variant
        const variantFilename = `${winner.clip_id}_${hookId}.mp4`;
        const variantPath = path.join(variantsDir, variantFilename);

        try {
          await renderTextOverlay(winner.filepath_clip, variantPath, hookText.trim(), {
            position: "top",
            fontSize: 48,
            fontColor: "white",
            strokeColor: "black",
            strokeWidth: 3,
          });

          insertVariantStmt.run(
            winner.clip_id,
            hookId,
            variantPath,
            "top_center_white_black_stroke",
            "generated"
          );

          console.log(
            `[MUTATE] Created mutated variant: ${variantFilename} with hook "${hookText.trim()}"`
          );
        } catch (error) {
          console.error(
            `[MUTATE] Error rendering variant ${variantFilename}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error(
        `[MUTATE] Error mutating winner variant_id=${winner.variant_id}:`,
        error
      );
    }
  }

  console.log(`[MUTATE] Mutation complete`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let snapshotHours = 24;

  for (const arg of args) {
    if (arg.startsWith("--snapshot=")) {
      snapshotHours = parseInt(arg.split("=")[1], 10);
      break;
    }
  }

  await mutateWinners(snapshotHours);
}

main().catch(console.error);


