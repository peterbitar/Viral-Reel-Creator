import { initSchema } from "../db/schema.js";
import { processIngestFile } from "../jobs/processors/ingest.js";
import path from "path";

initSchema();

const filepath = process.argv[2] || path.join(process.cwd(), "raw", "40eaa2d6-63a6-49df-9f17-07b42cae07fb.MP4");

async function main() {
  console.log(`[PROCESS] Processing video: ${filepath}`);
  await processIngestFile(filepath);
  console.log("[PROCESS] Ingest complete. Jobs enqueued.");
}

main().catch(console.error);


