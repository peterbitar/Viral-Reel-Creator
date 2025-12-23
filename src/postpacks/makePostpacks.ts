import path from "path";
import fs from "fs/promises";
import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";

initSchema();

interface VariantRow {
  id: number;
  clip_id: number;
  hook_id: number;
  filepath_variant: string;
}

interface ClipRow {
  id: number;
  start_sec: number;
  end_sec: number;
  created_at: string;
}

interface HookRow {
  id: number;
  hook_text: string;
}

interface CaptionRow {
  id: number;
  caption_text: string;
}

async function makePostpack(variantId: number): Promise<void> {
  // Fetch variant
  const variant = db
    .prepare(
      "SELECT id, clip_id, hook_id, filepath_variant FROM variants WHERE id = ?"
    )
    .get(variantId) as VariantRow | undefined;

  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  // Fetch clip info
  const clip = db
    .prepare("SELECT id, start_sec, end_sec, created_at FROM clips WHERE id = ?")
    .get(variant.clip_id) as ClipRow | undefined;

  if (!clip) {
    throw new Error(`Clip not found: ${variant.clip_id}`);
  }

  // Fetch hook text
  const hook = db
    .prepare("SELECT id, hook_text FROM hooks WHERE id = ?")
    .get(variant.hook_id) as HookRow | undefined;

  if (!hook) {
    throw new Error(`Hook not found: ${variant.hook_id}`);
  }

  // Fetch captions
  const captions = db
    .prepare("SELECT id, caption_text FROM captions WHERE variant_id = ?")
    .all(variantId) as CaptionRow[];

  // Create postpack directory
  const postpackDir = path.join(
    process.cwd(),
    "working",
    "postpacks",
    variantId.toString()
  );
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

  console.log(`[POSTPACKS] Created postpack at: ${postpackDir}`);
  console.log(`[POSTPACKS] Video: video.mp4`);
  console.log(`[POSTPACKS] Captions: ${captions.length} files`);
  console.log(`[POSTPACKS] Meta: meta.json`);
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
    console.error("[POSTPACKS] Usage: npm run postpacks -- --variant_id=<id>");
    process.exit(1);
  }

  await makePostpack(variantId);
}

main().catch(console.error);


