import chokidar from "chokidar";
import path from "path";
import { initSchema } from "../db/schema.js";
import { processIngestFile } from "../jobs/processors/ingest.js";

initSchema();

const rawDir = path.join(process.cwd(), "raw");

async function processVideo(filepath: string): Promise<void> {
  try {
    await processIngestFile(filepath);
  } catch (error) {
    console.error(`[INGEST] Error processing ${filepath}:`, error);
  }
}

function main(): void {
  console.log(`[INGEST] Watching directory: ${rawDir}`);

  const watcher = chokidar.watch(rawDir, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: false,
  });

  watcher.on("add", async (filepath) => {
    const ext = path.extname(filepath).toLowerCase();
    if ([".mp4", ".mov", ".avi", ".mkv"].includes(ext)) {
      await processVideo(filepath);
    }
  });

  console.log("[INGEST] Watcher started. Drop video files into /raw");
}

main();
