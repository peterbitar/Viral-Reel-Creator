import { processNextJob } from "./worker.js";
import { initSchema } from "../db/schema.js";

initSchema();

async function runWorker(jobType?: string) {
  const typeLabel = jobType || "all";
  console.log(`[WORKER] Starting worker for ${typeLabel} jobs...`);

  let processedCount = 0;
  let emptyIterations = 0;

  while (true) {
    try {
      const processed = await processNextJob(jobType as any);
      
      if (processed) {
        processedCount++;
        emptyIterations = 0;
        console.log(`[WORKER] Processed job #${processedCount}`);
      } else {
        emptyIterations++;
        if (emptyIterations >= 5) {
          // No jobs for 5 iterations, wait a bit
          await new Promise((resolve) => setTimeout(resolve, 2000));
          emptyIterations = 0;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      console.error("[WORKER] Error processing job:", error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const jobType = args[0] || undefined;

  if (jobType && !["ingest", "slice", "gen_hooks", "render", "gen_captions", "postpack", "score", "select_winners", "mutate"].includes(jobType)) {
    console.error(`Unknown job type: ${jobType}`);
    process.exit(1);
  }

  await runWorker(jobType);
}

main().catch((error) => {
  console.error("[WORKER] Fatal error:", error);
  process.exit(1);
});


