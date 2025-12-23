import path from "path";
import fs from "fs/promises";
import { db } from "../../db/db.js";
import { initSchema } from "../../db/schema.js";
import { sliceVideo } from "../../media/ffmpeg.js";
import { enqueueJob } from "../queue.js";
import { getActiveExperiment } from "../../experiments/manager.js";
import { loadConfig } from "../../config/loader.js";

initSchema();

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

export async function processSliceJob(videoId: number): Promise<void> {
  const video = db
    .prepare("SELECT id, filepath_raw, duration_sec FROM videos WHERE id = ?")
    .get(videoId) as { id: number; filepath_raw: string; duration_sec: number } | undefined;

  if (!video) {
    throw new Error(`Video not found: ${videoId}`);
  }

  const config = await loadConfig();
  const experimentId = await getActiveExperiment();
  const windows = generateClipWindows(
    video.duration_sec,
    config.clip_length_sec,
    config.overlap_sec
  );

  console.log(`[SLICE] Processing video_id=${videoId}, generating ${windows.length} clips`);

  const clipsDir = path.join(process.cwd(), "working", "clips");
  await fs.mkdir(clipsDir, { recursive: true });

  const insertStmt = db.prepare(
    "INSERT INTO clips (video_id, experiment_id, filepath_clip, start_sec, end_sec, clip_index) VALUES (?, ?, ?, ?, ?, ?)"
  );

  let clipIndex = 0;
  for (const window of windows) {
    const clipFilename = `${videoId}_${window.start.toFixed(2)}_${window.end.toFixed(2)}.mp4`;
    const clipPath = path.join(clipsDir, clipFilename);

    try {
      // Try to insert (will fail silently if UNIQUE constraint violated)
      let clipId: number;
      try {
        await sliceVideo(
          video.filepath_raw,
          clipPath,
          window.start,
          window.end - window.start
        );

        const result = insertStmt.run(
          video.id,
          experimentId,
          clipPath,
          window.start,
          window.end,
          clipIndex
        );
        clipId = Number(result.lastInsertRowid);
        console.log(`[SLICE] Created clip_id=${clipId}: ${clipFilename}`);
      } catch (error: any) {
        if (error.message && error.message.includes("UNIQUE")) {
          // Clip already exists, get its ID
          const existing = db
            .prepare("SELECT id FROM clips WHERE video_id = ? AND start_sec = ? AND end_sec = ?")
            .get(video.id, window.start, window.end) as { id: number } | undefined;
          if (existing) {
            clipId = existing.id;
            console.log(`[SLICE] Clip already exists, using clip_id=${clipId}`);
            // Skip slicing if file doesn't exist, but continue processing
            try {
              await fs.access(clipPath);
            } catch {
              // File missing, recreate it
              await sliceVideo(
                video.filepath_raw,
                clipPath,
                window.start,
                window.end - window.start
              );
            }
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      // Enqueue gen_hooks job for this clip
      enqueueJob("gen_hooks", "clip", clipId);
      clipIndex++;
    } catch (error) {
      console.error(`[SLICE] Error creating clip ${clipFilename}:`, error);
      // Continue with next clip
    }
  }
}


