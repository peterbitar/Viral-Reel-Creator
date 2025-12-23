import path from "path";
import fs from "fs/promises";
import { db } from "../../db/db.js";
import { initSchema } from "../../db/schema.js";
import { renderTextOverlay } from "../../media/ffmpeg.js";
import { enqueueJob } from "../queue.js";

initSchema();

export async function processRenderJob(clipId: number): Promise<void> {
  const clip = db
    .prepare("SELECT id, filepath_clip FROM clips WHERE id = ?")
    .get(clipId) as { id: number; filepath_clip: string } | undefined;

  if (!clip) {
    throw new Error(`Clip not found: ${clipId}`);
  }

  // Check if clip file exists
  try {
    await fs.access(clip.filepath_clip);
  } catch {
    throw new Error(`Clip file not found: ${clip.filepath_clip}`);
  }

  // Fetch all hooks for this clip (generation=1 by default)
  const hooks = db
    .prepare("SELECT id, hook_text FROM hooks WHERE clip_id = ? AND generation = 1")
    .all(clipId) as Array<{ id: number; hook_text: string }>;

  if (hooks.length === 0) {
    console.warn(`[RENDER] No hooks found for clip_id=${clipId}`);
    return;
  }

  console.log(`[RENDER] Rendering ${hooks.length} variants for clip_id=${clipId}...`);

  const variantsDir = path.join(process.cwd(), "working", "variants");
  await fs.mkdir(variantsDir, { recursive: true });

  const insertStmt = db.prepare(
    "INSERT INTO variants (clip_id, hook_id, filepath_variant, overlay_style, status, generation) VALUES (?, ?, ?, 'bottom_center_white_black_stroke_wrapped', 'generated', 1)"
  );

  let createdCount = 0;
  for (const hook of hooks) {
    const variantFilename = `${clipId}_${hook.id}.mp4`;
    const variantPath = path.join(variantsDir, variantFilename);

    try {
      // Check if variant already exists (UNIQUE constraint)
      const existing = db
        .prepare("SELECT id FROM variants WHERE clip_id = ? AND hook_id = ? AND overlay_style = ?")
        .get(clipId, hook.id, "bottom_center_white_black_stroke_wrapped") as { id: number } | undefined;

      if (existing) {
        console.log(`[RENDER] Variant already exists for clip_id=${clipId}, hook_id=${hook.id}, skipping`);
        // Still enqueue captions and postpack jobs for existing variant
        enqueueJob("gen_captions", "variant", existing.id);
        enqueueJob("postpack", "variant", existing.id);
        continue;
      }

      // Render variant following professional video composition rules (Rule of Thirds)
      // Position: top (HOOK zone - upper third, where hooks go)
      // Text wrapping: automatic based on video width (75% max width)
      await renderTextOverlay(clip.filepath_clip, variantPath, hook.hook_text, {
        position: "top", // HOOK zone - upper third, where engaging hooks are positioned
        // fontSize: undefined = responsive based on video height
        fontColor: "white",
        strokeColor: "black",
        strokeWidth: 5,
      });

      const result = insertStmt.run(clipId, hook.id, variantPath);
      const variantId = Number(result.lastInsertRowid);
      createdCount++;

      // Enqueue captions and postpack jobs
      enqueueJob("gen_captions", "variant", variantId);
      enqueueJob("postpack", "variant", variantId);
    } catch (error: any) {
      if (error.message && error.message.includes("UNIQUE")) {
        // Variant already exists
        const existing = db
          .prepare("SELECT id FROM variants WHERE clip_id = ? AND hook_id = ? AND overlay_style = ?")
          .get(clipId, hook.id, "bottom_center_white_black_stroke_wrapped") as { id: number } | undefined;
        if (existing) {
          enqueueJob("gen_captions", "variant", existing.id);
          enqueueJob("postpack", "variant", existing.id);
        }
      } else {
        console.error(`[RENDER] Error creating variant for hook_id=${hook.id}:`, error);
      }
    }
  }

  console.log(`[RENDER] Created ${createdCount} new variants for clip_id=${clipId}`);
}

