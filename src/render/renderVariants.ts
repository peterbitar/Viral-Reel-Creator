import path from "path";
import fs from "fs/promises";
import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";
import { renderTextOverlay } from "../media/ffmpeg.js";

initSchema();

interface ClipRow {
  id: number;
  filepath_clip: string;
}

interface HookRow {
  id: number;
  hook_text: string;
}

async function renderVariants(clipId: number): Promise<void> {
  // Fetch clip
  const clip = db
    .prepare("SELECT id, filepath_clip FROM clips WHERE id = ?")
    .get(clipId) as ClipRow | undefined;

  if (!clip) {
    throw new Error(`Clip not found: ${clipId}`);
  }

  // Check if clip file exists
  try {
    await fs.access(clip.filepath_clip);
  } catch {
    throw new Error(`Clip file not found: ${clip.filepath_clip}`);
  }

  // Fetch all hooks for this clip
  const hooks = db
    .prepare("SELECT id, hook_text FROM hooks WHERE clip_id = ?")
    .all(clipId) as HookRow[];

  if (hooks.length === 0) {
    console.warn(`[RENDER] No hooks found for clip_id=${clipId}. Generate hooks first.`);
    return;
  }

  console.log(
    `[RENDER] Rendering ${hooks.length} variants for clip_id=${clipId}...`
  );

  const variantsDir = path.join(process.cwd(), "working", "variants");
  await fs.mkdir(variantsDir, { recursive: true });

  const insertStmt = db.prepare(
    "INSERT INTO variants (clip_id, hook_id, filepath_variant, overlay_style, status) VALUES (?, ?, ?, ?, ?)"
  );

  for (const hook of hooks) {
    const variantFilename = `${clipId}_${hook.id}.mp4`;
    const variantPath = path.join(variantsDir, variantFilename);

    try {
      await renderTextOverlay(clip.filepath_clip, variantPath, hook.hook_text, {
        position: "top",
        fontSize: 48,
        fontColor: "white",
        strokeColor: "black",
        strokeWidth: 3,
      });

      insertStmt.run(
        clipId,
        hook.id,
        variantPath,
        "top_center_white_black_stroke",
        "generated"
      );

      console.log(
        `[RENDER] Created variant: ${variantFilename} with hook "${hook.hook_text}"`
      );
    } catch (error) {
      console.error(
        `[RENDER] Error creating variant ${variantFilename}:`,
        error
      );
    }
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
    console.error("[RENDER] Usage: npm run render -- --clip_id=<id>");
    process.exit(1);
  }

  await renderVariants(clipId);
}

main().catch(console.error);


