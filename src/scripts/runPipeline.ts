import { initSchema } from "../db/schema.js";
import { db } from "../db/db.js";
import { enqueueJob } from "../jobs/queue.js";
import { processSliceJob } from "../jobs/processors/slice.js";
import { processGenHooksJob } from "../jobs/processors/genHooks.js";

initSchema();

async function runPipeline() {
  // Get all clips without hooks
  const clips = db.prepare("SELECT id FROM clips").all() as Array<{ id: number }>;
  
  console.log(`[PIPELINE] Found ${clips.length} clips`);

  for (const clip of clips) {
    // Check if clip already has hooks
    const hookCount = db.prepare("SELECT COUNT(*) as count FROM hooks WHERE clip_id = ?").get(clip.id) as { count: number };
    
    if (hookCount.count === 0) {
      console.log(`[PIPELINE] Generating hooks for clip_id=${clip.id}...`);
      try {
        await processGenHooksJob(clip.id);
      } catch (error) {
        console.error(`[PIPELINE] Error processing clip_id=${clip.id}:`, error);
      }
    } else {
      console.log(`[PIPELINE] Clip_id=${clip.id} already has ${hookCount.count} hooks, skipping`);
      // Enqueue render job
      enqueueJob("render", "clip", clip.id);
    }
  }

  console.log("[PIPELINE] Hook generation complete. Render jobs enqueued.");
}

runPipeline().catch(console.error);


