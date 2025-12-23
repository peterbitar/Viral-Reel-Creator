import path from "path";
import fs from "fs/promises";
import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";
import { getDurationSec } from "../media/ffprobe.js";
import { sliceVideo } from "../media/ffmpeg.js";

initSchema();

const config = {
  clip_length_sec: 9,
  overlap_sec: 1,
};

async function loadConfig(): Promise<void> {
  try {
    const configPath = path.join(process.cwd(), "config", "default.json");
    const configData = await fs.readFile(configPath, "utf-8");
    Object.assign(config, JSON.parse(configData));
  } catch (error) {
    console.warn("[SLICE] Using default config, could not load config file");
  }
}

interface VideoRow {
  id: number;
  filepath_raw: string;
  duration_sec: number;
}

async function getVideo(videoIdOrFilepath: string): Promise<VideoRow | null> {
  await loadConfig();

  // Try as ID first
  const id = parseInt(videoIdOrFilepath, 10);
  if (!isNaN(id)) {
    const row = db
      .prepare("SELECT id, filepath_raw, duration_sec FROM videos WHERE id = ?")
      .get(id) as VideoRow | undefined;
    if (row) return row;
  }

  // Try as filepath
  const row = db
    .prepare(
      "SELECT id, filepath_raw, duration_sec FROM videos WHERE filepath_raw = ?"
    )
    .get(videoIdOrFilepath) as VideoRow | undefined;

  if (row) return row;

  // If not in DB, try to get duration and create entry
  try {
    const duration = await getDurationSec(videoIdOrFilepath);
    const stmt = db.prepare(
      "INSERT INTO videos (filepath_raw, duration_sec) VALUES (?, ?)"
    );
    const result = stmt.run(videoIdOrFilepath, duration);
    return {
      id: Number(result.lastInsertRowid),
      filepath_raw: videoIdOrFilepath,
      duration_sec: duration,
    };
  } catch (error) {
    console.error(`[SLICE] Could not process video: ${error}`);
    return null;
  }
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

async function processVideo(video: VideoRow): Promise<void> {
  const windows = generateClipWindows(
    video.duration_sec,
    config.clip_length_sec,
    config.overlap_sec
  );

  console.log(
    `[SLICE] Processing video_id=${video.id}, duration=${video.duration_sec.toFixed(2)}s, generating ${windows.length} clips`
  );

  const clipsDir = path.join(process.cwd(), "working", "clips");
  await fs.mkdir(clipsDir, { recursive: true });

  const insertStmt = db.prepare(
    "INSERT INTO clips (video_id, filepath_clip, start_sec, end_sec) VALUES (?, ?, ?, ?)"
  );

  for (const window of windows) {
    const clipFilename = `${video.id}_${window.start.toFixed(2)}_${window.end.toFixed(2)}.mp4`;
    const clipPath = path.join(clipsDir, clipFilename);

    try {
      await sliceVideo(
        video.filepath_raw,
        clipPath,
        window.start,
        window.end - window.start
      );

      insertStmt.run(video.id, clipPath, window.start, window.end);

      console.log(
        `[SLICE] Created clip: ${clipFilename} (${window.start.toFixed(2)}s - ${window.end.toFixed(2)}s)`
      );
    } catch (error) {
      console.error(
        `[SLICE] Error creating clip ${clipFilename}:`,
        error
      );
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let videoIdOrFilepath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--video_id" && i + 1 < args.length) {
      videoIdOrFilepath = args[i + 1];
      break;
    } else if (args[i] === "--filepath" && i + 1 < args.length) {
      videoIdOrFilepath = args[i + 1];
      break;
    } else if (args[i].startsWith("--video_id=")) {
      videoIdOrFilepath = args[i].split("=")[1];
      break;
    } else if (args[i].startsWith("--filepath=")) {
      videoIdOrFilepath = args[i].split("=")[1];
      break;
    }
  }

  if (!videoIdOrFilepath) {
    console.error("[SLICE] Usage: npm run slice -- --video_id=<id> OR --filepath=<path>");
    process.exit(1);
  }

  const video = await getVideo(videoIdOrFilepath);
  if (!video) {
    console.error(`[SLICE] Video not found: ${videoIdOrFilepath}`);
    process.exit(1);
  }

  await processVideo(video);
}

main().catch(console.error);


