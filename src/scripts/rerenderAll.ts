import { initSchema } from "../db/schema.js";
import { db } from "../db/db.js";
import { enqueueJob } from "../jobs/queue.js";

initSchema();

async function rerenderAll() {
  // Get all clips with hooks
  const clips = db
    .prepare("SELECT DISTINCT clip_id FROM hooks")
    .all() as Array<{ clip_id: number }>;

  console.log(`[RERENDER] Found ${clips.length} clips to render`);

  for (const { clip_id } of clips) {
    enqueueJob("render", "clip", clip_id);
    console.log(`[RERENDER] Enqueued render job for clip_id=${clip_id}`);
  }

  console.log(`[RERENDER] Enqueued ${clips.length} render jobs`);
}

rerenderAll().catch(console.error);


