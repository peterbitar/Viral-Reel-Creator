import { processNextJob } from "./worker.js";
import { initSchema } from "../db/schema.js";

initSchema();

async function main() {
  const args = process.argv.slice(2);
  const jobType = args[0] || undefined;

  if (jobType && !["ingest", "slice", "gen_hooks", "render", "gen_captions", "postpack", "score", "select_winners", "mutate"].includes(jobType)) {
    console.error(`Unknown job type: ${jobType}`);
    console.error("Usage: npm run job -- [job_type]");
    console.error("Valid job types: ingest, slice, gen_hooks, render, gen_captions, postpack, score, select_winners, mutate");
    process.exit(1);
  }

  const processed = await processNextJob(jobType);
  if (!processed) {
    console.log(`[JOB] No pending ${jobType || "jobs"} found`);
  }
}

main().catch((error) => {
  console.error("[JOB] Error:", error);
  process.exit(1);
});


