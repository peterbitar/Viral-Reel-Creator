import {
  getNextPendingJob,
  markJobRunning,
  markJobDone,
  markJobFailed,
  Job,
} from "./queue.js";
import { processIngestFile } from "./processors/ingest.js";
import { processSliceJob } from "./processors/slice.js";
import { processGenHooksJob } from "./processors/genHooks.js";
import { processRenderJob } from "./processors/render.js";
import { processGenCaptionsJob } from "./processors/genCaptions.js";
import { processPostpackJob } from "./processors/postpack.js";
import { processScoreJob } from "./processors/score.js";
import { processSelectWinnersJob } from "./processors/selectWinners.js";
import { processMutateJob } from "./processors/mutate.js";

export async function processJob(job: Job): Promise<void> {
  markJobRunning(job.id);

  try {
    switch (job.job_type) {
      case "ingest":
        // Ingest uses filepath, not entity_id
        throw new Error("Ingest jobs must be processed with filepath directly");

      case "slice":
        await processSliceJob(job.entity_id);
        break;

      case "gen_hooks":
        await processGenHooksJob(job.entity_id);
        break;

      case "render":
        await processRenderJob(job.entity_id);
        break;

      case "gen_captions":
        await processGenCaptionsJob(job.entity_id);
        break;

      case "postpack":
        await processPostpackJob(job.entity_id);
        break;

      case "score":
        await processScoreJob(job.entity_id);
        break;

      case "select_winners":
        await processSelectWinnersJob(job.entity_id);
        break;

      case "mutate":
        await processMutateJob(job.entity_id);
        break;

      default:
        throw new Error(`Unknown job type: ${job.job_type}`);
    }

    markJobDone(job.id);
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    markJobFailed(job.id, errorMessage);
    throw error;
  }
}

export async function processNextJob(jobType?: string): Promise<boolean> {
  const job = getNextPendingJob(jobType as any);
  if (!job) {
    return false;
  }

  await processJob(job);
  return true;
}


