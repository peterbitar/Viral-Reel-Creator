import { db } from "../../db/db.js";
import { initSchema } from "../../db/schema.js";
import { enqueueJob } from "../queue.js";
import { loadConfig } from "../../config/loader.js";

initSchema();

export async function processSelectWinnersJob(experimentId: number): Promise<void> {
  const experiment = db
    .prepare("SELECT id FROM experiments WHERE id = ?")
    .get(experimentId) as { id: number } | undefined;

  if (!experiment) {
    throw new Error(`Experiment not found: ${experimentId}`);
  }

  const config = await loadConfig();

  // Get all clips for this experiment
  const clips = db
    .prepare("SELECT id FROM clips WHERE experiment_id = ?")
    .all(experimentId) as Array<{ id: number }>;

  if (clips.length === 0) {
    console.log(`[SELECT_WINNERS] No clips found for experiment_id=${experimentId}`);
    return;
  }

  console.log(`[SELECT_WINNERS] Processing ${clips.length} clips for experiment_id=${experimentId}`);

  const insertWinnerStmt = db.prepare(
    "INSERT INTO winners (clip_id, variant_id, snapshot_hours, rank) VALUES (?, ?, ?, ?)"
  );

  const updateVariantStatusStmt = db.prepare(
    "UPDATE variants SET status = ? WHERE id = ?"
  );

  let totalWinners = 0;
  let totalDead = 0;

  // Use latest 24h snapshot
  const snapshotHours = 24;

  for (const clip of clips) {
    // Get scores for variants from this clip
    const scores = db
      .prepare(
        `SELECT s.post_id, v.id as variant_id, s.score_value
         FROM scores s
         JOIN posts p ON s.post_id = p.id
         JOIN variants v ON p.variant_id = v.id
         WHERE v.clip_id = ? AND s.snapshot_hours = ?
         ORDER BY s.score_value DESC`
      )
      .all(clip.id, snapshotHours) as Array<{
      post_id: number;
      variant_id: number;
      score_value: number;
    }>;

    if (scores.length === 0) {
      continue;
    }

    const top20PercentCount = Math.ceil(scores.length * config.winner_top_pct);
    const bottom50PercentStart = Math.floor(scores.length * config.dead_bottom_pct);

    // Mark winners (top 20%)
    for (let i = 0; i < top20PercentCount; i++) {
      const score = scores[i];
      insertWinnerStmt.run(clip.id, score.variant_id, snapshotHours, i + 1);
      updateVariantStatusStmt.run("winner", score.variant_id);
      totalWinners++;

      // Enqueue mutate job for winner
      enqueueJob("mutate", "variant", score.variant_id);
    }

    // Mark dead (bottom 50%)
    for (let i = bottom50PercentStart; i < scores.length; i++) {
      const score = scores[i];
      updateVariantStatusStmt.run("dead", score.variant_id);
      totalDead++;
    }
  }

  console.log(
    `[SELECT_WINNERS] Selected ${totalWinners} winners and marked ${totalDead} as dead for experiment_id=${experimentId}`
  );
}


