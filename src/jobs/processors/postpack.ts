import path from "path";
import fs from "fs/promises";
import { db } from "../../db/db.js";
import { initSchema } from "../../db/schema.js";

initSchema();

export async function processPostpackJob(variantId: number): Promise<void> {
  const variant = db
    .prepare(
      "SELECT id, clip_id, hook_id, filepath_variant FROM variants WHERE id = ?"
    )
    .get(variantId) as {
    id: number;
    clip_id: number;
    hook_id: number;
    filepath_variant: string;
  } | undefined;

  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  const clip = db
    .prepare("SELECT id, start_sec, end_sec, created_at FROM clips WHERE id = ?")
    .get(variant.clip_id) as {
    id: number;
    start_sec: number;
    end_sec: number;
    created_at: string;
  } | undefined;

  if (!clip) {
    throw new Error(`Clip not found: ${variant.clip_id}`);
  }

  const hook = db
    .prepare("SELECT id, hook_text FROM hooks WHERE id = ?")
    .get(variant.hook_id) as { id: number; hook_text: string } | undefined;

  if (!hook) {
    throw new Error(`Hook not found: ${variant.hook_id}`);
  }

  const captions = db
    .prepare("SELECT id, caption_text FROM captions WHERE variant_id = ?")
    .all(variantId) as Array<{ id: number; caption_text: string }>;

  const postpackDir = path.join(process.cwd(), "working", "postpacks", variantId.toString());
  await fs.mkdir(postpackDir, { recursive: true });

  // Check if variant video exists
  try {
    await fs.access(variant.filepath_variant);
  } catch {
    throw new Error(`Variant video not found: ${variant.filepath_variant}`);
  }

  // Copy variant video to video.mp4
  const videoDest = path.join(postpackDir, "video.mp4");
  await fs.copyFile(variant.filepath_variant, videoDest);

  // Write caption files
  for (let i = 0; i < captions.length; i++) {
    const captionFile = path.join(postpackDir, `caption_${i + 1}.txt`);
    await fs.writeFile(captionFile, captions[i].caption_text, "utf-8");
  }

  // Write meta.json
  const meta = {
    clip_id: clip.id,
    hook_text: hook.hook_text,
    start_sec: clip.start_sec,
    end_sec: clip.end_sec,
    created_at: clip.created_at,
  };
  const metaPath = path.join(postpackDir, "meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  // Mark variant status as generated (if not already set)
  db.prepare("UPDATE variants SET status = 'generated' WHERE id = ?").run(variantId);

  console.log(`[POSTPACK] Created postpack for variant_id=${variantId}`);
}

