import path from "path";
import fs from "fs/promises";
import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";
import { getDurationSec } from "../media/ffprobe.js";
import { sliceVideo } from "../media/ffmpeg.js";
import { llmJson } from "../llm/client.js";
import { renderTextOverlay } from "../media/ffmpeg.js";

initSchema();

const rawDir = path.join(process.cwd(), "raw");
const clipsDir = path.join(process.cwd(), "working", "clips");
const variantsDir = path.join(process.cwd(), "working", "variants");
const postpacksDir = path.join(process.cwd(), "working", "postpacks");

interface VideoRow {
  id: number;
  filepath_raw: string;
  duration_sec: number;
}

interface ClipRow {
  id: number;
  filepath_clip: string;
  start_sec: number;
  end_sec: number;
  created_at: string;
}

interface HookRow {
  id: number;
  hook_text: string;
}

interface VariantRow {
  id: number;
  filepath_variant: string;
  clip_id: number;
  hook_id: number;
}

async function loadConfig() {
  const config = {
    clip_length_sec: 9,
    overlap_sec: 1,
  };
  try {
    const configPath = path.join(process.cwd(), "config", "default.json");
    const configData = await fs.readFile(configPath, "utf-8");
    Object.assign(config, JSON.parse(configData));
  } catch (error) {
    console.warn("[PIPELINE] Using default config");
  }
  return config;
}

function generateClipWindows(
  durationSec: number,
  clipLengthSec: number,
  overlapSec: number
): Array<{ start: number; end: number }> {
  if (durationSec <= 15) {
    return [{ start: 0, end: durationSec }];
  }

  const windows: Array<{ start: number; end: number }> = [];
  let start = 0;
  const step = clipLengthSec - overlapSec;

  while (start < durationSec) {
    const end = Math.min(start + clipLengthSec, durationSec);
    windows.push({ start, end });
    if (end >= durationSec) break;
    start += step;
  }

  return windows;
}

async function ingestVideo(filepath: string): Promise<number> {
  console.log(`[PIPELINE] Ingesting: ${path.basename(filepath)}`);
  const duration = await getDurationSec(filepath);
  const stmt = db.prepare(
    "INSERT INTO videos (filepath_raw, duration_sec) VALUES (?, ?)"
  );
  const result = stmt.run(filepath, duration);
  const videoId = Number(result.lastInsertRowid);
  console.log(`[PIPELINE] Ingested video_id=${videoId}, duration=${duration.toFixed(2)}s`);
  return videoId;
}

async function sliceVideoIntoClips(videoId: number): Promise<number[]> {
  const video = db
    .prepare("SELECT id, filepath_raw, duration_sec FROM videos WHERE id = ?")
    .get(videoId) as VideoRow | undefined;

  if (!video) {
    throw new Error(`Video not found: ${videoId}`);
  }

  const config = await loadConfig();
  const windows = generateClipWindows(
    video.duration_sec,
    config.clip_length_sec,
    config.overlap_sec
  );

  console.log(`[PIPELINE] Slicing into ${windows.length} clips...`);
  await fs.mkdir(clipsDir, { recursive: true });

  const insertStmt = db.prepare(
    "INSERT INTO clips (video_id, filepath_clip, start_sec, end_sec) VALUES (?, ?, ?, ?)"
  );

  const clipIds: number[] = [];

  for (const window of windows) {
    const clipFilename = `${videoId}_${window.start.toFixed(2)}_${window.end.toFixed(2)}.mp4`;
    const clipPath = path.join(clipsDir, clipFilename);

    await sliceVideo(
      video.filepath_raw,
      clipPath,
      window.start,
      window.end - window.start
    );

    const result = insertStmt.run(video.id, clipPath, window.start, window.end);
    clipIds.push(Number(result.lastInsertRowid));
  }

  return clipIds;
}

async function generateHooksForClip(clipId: number): Promise<number[]> {
  const prompt = `Generate 30 ultra-short hooks (3–6 words). Purpose: maximize curiosity or sensory replay for a close-up cat eating treat video. Avoid emojis. Avoid health claims. Keep language simple. Return JSON with a single field "hooks" containing an array of strings only. Example: {"hooks": ["Watch this", "You won't believe", ...]}`;

  console.log(`[PIPELINE] Generating hooks for clip_id=${clipId}...`);

  const response = await llmJson(prompt);
  const hooks = response.hooks || [];

  if (!Array.isArray(hooks) || hooks.length === 0) {
    throw new Error("LLM did not return a valid hooks array");
  }

  const insertStmt = db.prepare(
    "INSERT INTO hooks (clip_id, hook_text, hook_style) VALUES (?, ?, ?)"
  );

  const hookIds: number[] = [];

  for (const hook of hooks) {
    if (typeof hook === "string" && hook.trim().length > 0) {
      const result = insertStmt.run(clipId, hook.trim(), "auto");
      hookIds.push(Number(result.lastInsertRowid));
    }
  }

  return hookIds;
}

async function renderVariantsForClip(clipId: number): Promise<number[]> {
  const clip = db
    .prepare("SELECT id, filepath_clip FROM clips WHERE id = ?")
    .get(clipId) as ClipRow | undefined;

  if (!clip) {
    throw new Error(`Clip not found: ${clipId}`);
  }

  const hooks = db
    .prepare("SELECT id, hook_text FROM hooks WHERE clip_id = ?")
    .all(clipId) as HookRow[];

  if (hooks.length === 0) {
    return [];
  }

  console.log(`[PIPELINE] Rendering ${hooks.length} variants for clip_id=${clipId}...`);
  await fs.mkdir(variantsDir, { recursive: true });

  const insertStmt = db.prepare(
    "INSERT INTO variants (clip_id, hook_id, filepath_variant, overlay_style, status) VALUES (?, ?, ?, ?, ?)"
  );

  const variantIds: number[] = [];

  for (const hook of hooks) {
    const variantFilename = `${clipId}_${hook.id}.mp4`;
    const variantPath = path.join(variantsDir, variantFilename);

    await renderTextOverlay(clip.filepath_clip, variantPath, hook.hook_text, {
      position: "top",
      fontSize: 48,
      fontColor: "white",
      strokeColor: "black",
      strokeWidth: 3,
    });

    const result = insertStmt.run(
      clipId,
      hook.id,
      variantPath,
      "top_center_white_black_stroke",
      "generated"
    );
    variantIds.push(Number(result.lastInsertRowid));
  }

  return variantIds;
}

async function generateCaptionsForVariant(variantId: number): Promise<void> {
  const prompt = `Write 3 short captions (1–2 lines) for a TikTok/IG Reel showing a cat eating a treat. Must feel casual, not like an ad. No hashtags. Return JSON with a single field "captions" containing an array of strings. Example: {"captions": ["This is so cute!", "Watch this", "You have to see this"]}`;

  const response = await llmJson(prompt);
  const captions = response.captions || [];

  if (!Array.isArray(captions) || captions.length === 0) {
    return; // Skip if no captions
  }

  const insertStmt = db.prepare(
    "INSERT INTO captions (variant_id, caption_text) VALUES (?, ?)"
  );

  for (const caption of captions) {
    if (typeof caption === "string" && caption.trim().length > 0) {
      insertStmt.run(variantId, caption.trim());
    }
  }
}

async function createPostpack(variantId: number): Promise<void> {
  const variant = db
    .prepare(
      "SELECT id, clip_id, hook_id, filepath_variant FROM variants WHERE id = ?"
    )
    .get(variantId) as VariantRow | undefined;

  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  const clip = db
    .prepare("SELECT id, start_sec, end_sec, created_at FROM clips WHERE id = ?")
    .get(variant.clip_id) as ClipRow | undefined;

  if (!clip) {
    throw new Error(`Clip not found: ${variant.clip_id}`);
  }

  const hook = db
    .prepare("SELECT id, hook_text FROM hooks WHERE id = ?")
    .get(variant.hook_id) as HookRow | undefined;

  if (!hook) {
    throw new Error(`Hook not found: ${variant.hook_id}`);
  }

  const captions = db
    .prepare("SELECT id, caption_text FROM captions WHERE variant_id = ?")
    .all(variantId) as Array<{ id: number; caption_text: string }>;

  const postpackDir = path.join(postpacksDir, variantId.toString());
  await fs.mkdir(postpackDir, { recursive: true });

  const videoDest = path.join(postpackDir, "video.mp4");
  await fs.copyFile(variant.filepath_variant, videoDest);

  for (let i = 0; i < captions.length; i++) {
    const captionFile = path.join(postpackDir, `caption_${i + 1}.txt`);
    await fs.writeFile(captionFile, captions[i].caption_text, "utf-8");
  }

  const meta = {
    clip_id: clip.id,
    hook_text: hook.hook_text,
    start_sec: clip.start_sec,
    end_sec: clip.end_sec,
    created_at: clip.created_at,
  };
  const metaPath = path.join(postpackDir, "meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

async function processAll(): Promise<void> {
  console.log("[PIPELINE] Starting full pipeline...");

  // Find all videos in /raw
  const files = await fs.readdir(rawDir);
  const videoFiles = files.filter((f) =>
    [".mp4", ".mov", ".avi", ".mkv"].includes(path.extname(f).toLowerCase())
  );

  if (videoFiles.length === 0) {
    console.log("[PIPELINE] No video files found in /raw directory");
    return;
  }

  for (const file of videoFiles) {
    const filepath = path.join(rawDir, file);

    try {
      // Check if already processed
      const existing = db
        .prepare("SELECT id FROM videos WHERE filepath_raw = ?")
        .get(filepath) as { id: number } | undefined;

      if (existing) {
        console.log(`[PIPELINE] Skipping already processed: ${file}`);
        continue;
      }

      // Step 1: Ingest
      const videoId = await ingestVideo(filepath);

      // Step 2: Slice
      const clipIds = await sliceVideoIntoClips(videoId);

      // Step 3-7: For each clip, generate hooks, render variants, generate captions, create postpacks
      for (const clipId of clipIds) {
        try {
          // Generate hooks
          const hookIds = await generateHooksForClip(clipId);

          // Render variants
          const variantIds = await renderVariantsForClip(clipId);

          // Generate captions and create postpacks for each variant
          for (const variantId of variantIds) {
            try {
              await generateCaptionsForVariant(variantId);
              await createPostpack(variantId);
              console.log(`[PIPELINE] Created postpack for variant_id=${variantId}`);
            } catch (error) {
              console.error(
                `[PIPELINE] Error processing variant_id=${variantId}:`,
                error
              );
            }
          }
        } catch (error) {
          console.error(`[PIPELINE] Error processing clip_id=${clipId}:`, error);
        }
      }

      console.log(`[PIPELINE] Completed processing: ${file}`);
    } catch (error) {
      console.error(`[PIPELINE] Error processing ${file}:`, error);
    }
  }

  console.log("[PIPELINE] Pipeline complete!");
}

processAll().catch(console.error);


