import { db } from "../../db/db.js";
import { initSchema } from "../../db/schema.js";
import { getDurationSec } from "../../media/ffprobe.js";
import { enqueueJob } from "../queue.js";
import { getActiveExperiment } from "../../experiments/manager.js";

initSchema();

export async function processIngestJob(entityId: number): Promise<void> {
  // For ingest, entity_id is not used, we process by filepath
  // This processor should be called with filepath directly
  throw new Error("Ingest job should be processed with filepath, not entityId");
}

export async function processIngestFile(filepath: string): Promise<void> {
  try {
    // Get duration
    const duration = await getDurationSec(filepath);

    // Insert video (will fail silently if UNIQUE constraint violated)
    let videoId: number;
    try {
      const stmt = db.prepare(
        "INSERT INTO videos (filepath_raw, duration_sec) VALUES (?, ?)"
      );
      const result = stmt.run(filepath, duration);
      videoId = Number(result.lastInsertRowid);
      console.log(`[INGEST] Created video_id=${videoId} for ${filepath}`);
    } catch (error: any) {
      if (error.message && error.message.includes("UNIQUE")) {
        // Video already exists, get its ID
        const existing = db
          .prepare("SELECT id FROM videos WHERE filepath_raw = ?")
          .get(filepath) as { id: number } | undefined;
        if (existing) {
          videoId = existing.id;
          console.log(`[INGEST] Video already exists, using video_id=${videoId}`);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    // Enqueue slice job for this video
    enqueueJob("slice", "video", videoId);
    console.log(`[INGEST] Enqueued slice job for video_id=${videoId}`);
  } catch (error) {
    console.error(`[INGEST] Error processing ${filepath}:`, error);
    throw error;
  }
}


