import path from "path";
import fs from "fs/promises";
import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";
import { llmJson } from "../llm/client.js";
import { renderTextOverlay } from "../media/ffmpeg.js";

initSchema();

const clipsDir = path.join(process.cwd(), "working", "clips");
const variantsDir = path.join(process.cwd(), "working", "variants");
const postpacksDir = path.join(process.cwd(), "working", "postpacks");

interface ClipRow {
  id: number;
  filepath_clip: string;
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

async function generateHooksForClip(clipId: number): Promise<number[]> {
  const prompt = `Generate 30 ultra-short hooks (3–6 words). Purpose: maximize curiosity or sensory replay for a close-up cat eating treat video. Avoid emojis. Avoid health claims. Keep language simple. Return JSON with a single field "hooks" containing an array of strings only. Example: {"hooks": ["Watch this", "You won't believe", ...]}`;

  console.log(`[CONTINUE] Generating hooks for clip_id=${clipId}...`);

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

  console.log(`[CONTINUE] Rendering ${hooks.length} variants for clip_id=${clipId}...`);
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
    .get(variant.clip_id) as { id: number; start_sec: number; end_sec: number; created_at: string } | undefined;

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

async function continueProcessing(): Promise<void> {
  console.log("[CONTINUE] Continuing processing for clips without hooks...");

  // Find clips without hooks
  const clipsWithoutHooks = db
    .prepare(
      `SELECT c.id FROM clips c
       LEFT JOIN hooks h ON c.id = h.clip_id
       WHERE h.id IS NULL`
    )
    .all() as Array<{ id: number }>;

  if (clipsWithoutHooks.length === 0) {
    console.log("[CONTINUE] All clips have hooks. Checking for variants...");
  } else {
    console.log(`[CONTINUE] Found ${clipsWithoutHooks.length} clips without hooks`);
    for (const clip of clipsWithoutHooks) {
      try {
        await generateHooksForClip(clip.id);
      } catch (error) {
        console.error(`[CONTINUE] Error generating hooks for clip_id=${clip.id}:`, error);
      }
    }
  }

  // Find clips with hooks but without variants
  const clipsWithoutVariants = db
    .prepare(
      `SELECT DISTINCT c.id FROM clips c
       JOIN hooks h ON c.id = h.clip_id
       LEFT JOIN variants v ON c.id = v.clip_id
       WHERE v.id IS NULL`
    )
    .all() as Array<{ id: number }>;

  if (clipsWithoutVariants.length > 0) {
    console.log(`[CONTINUE] Found ${clipsWithoutVariants.length} clips with hooks but without variants`);
    for (const clip of clipsWithoutVariants) {
      try {
        await renderVariantsForClip(clip.id);
      } catch (error) {
        console.error(`[CONTINUE] Error rendering variants for clip_id=${clip.id}:`, error);
      }
    }
  }

  // Find variants without captions
  const variantsWithoutCaptions = db
    .prepare(
      `SELECT v.id FROM variants v
       LEFT JOIN captions c ON v.id = c.variant_id
       WHERE c.id IS NULL`
    )
    .all() as Array<{ id: number }>;

  if (variantsWithoutCaptions.length > 0) {
    console.log(`[CONTINUE] Found ${variantsWithoutCaptions.length} variants without captions`);
    for (const variant of variantsWithoutCaptions) {
      try {
        await generateCaptionsForVariant(variant.id);
      } catch (error) {
        console.error(`[CONTINUE] Error generating captions for variant_id=${variant.id}:`, error);
      }
    }
  }

  // Find variants without postpacks (check if postpack directory exists)
  const allVariants = db
    .prepare("SELECT id FROM variants")
    .all() as Array<{ id: number }>;

  let postpacksCreated = 0;
  for (const variant of allVariants) {
    const postpackDir = path.join(postpacksDir, variant.id.toString());
    try {
      await fs.access(postpackDir);
    } catch {
      // Postpack doesn't exist, create it
      try {
        await createPostpack(variant.id);
        postpacksCreated++;
      } catch (error) {
        console.error(`[CONTINUE] Error creating postpack for variant_id=${variant.id}:`, error);
      }
    }
  }

  if (postpacksCreated > 0) {
    console.log(`[CONTINUE] Created ${postpacksCreated} postpacks`);
  }

  console.log("[CONTINUE] Processing complete!");
}

continueProcessing().catch(console.error);


