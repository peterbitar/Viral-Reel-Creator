import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";

initSchema();

interface ScoreRow {
  post_id: number;
  clip_id: number;
  variant_id: number;
  score_value: number;
}

async function selectWinners(snapshotHours: number = 24): Promise<void> {
  // Get latest scores for the specified snapshot
  const scores = db
    .prepare(
      `SELECT s.post_id, v.clip_id, v.id as variant_id, s.score_value
       FROM scores s
       JOIN posts p ON s.post_id = p.id
       JOIN variants v ON p.variant_id = v.id
       WHERE s.snapshot_hours = ?
       ORDER BY s.score_value DESC`
    )
    .all(snapshotHours) as ScoreRow[];

  if (scores.length === 0) {
    console.log(
      `[WINNERS] No scores found for snapshot=${snapshotHours}h. Run score computation first.`
    );
    return;
  }

  console.log(
    `[WINNERS] Processing ${scores.length} variants for snapshot=${snapshotHours}h...`
  );

  // Group by clip_id to rank within each clip group
  const byClipId = new Map<number, ScoreRow[]>();
  for (const score of scores) {
    if (!byClipId.has(score.clip_id)) {
      byClipId.set(score.clip_id, []);
    }
    byClipId.get(score.clip_id)!.push(score);
  }

  const insertWinnerStmt = db.prepare(
    "INSERT INTO winners (clip_id, variant_id, snapshot_hours, rank) VALUES (?, ?, ?, ?)"
  );

  const updateVariantStatusStmt = db.prepare(
    "UPDATE variants SET status = ? WHERE id = ?"
  );

  let totalWinners = 0;
  let totalDead = 0;

  for (const [clipId, clipScores] of byClipId.entries()) {
    const top20PercentCount = Math.ceil(clipScores.length * 0.2);
    const bottom50PercentStart = Math.floor(clipScores.length * 0.5);

    // Mark winners (top 20%)
    for (let i = 0; i < top20PercentCount; i++) {
      const score = clipScores[i];
      insertWinnerStmt.run(score.clip_id, score.variant_id, snapshotHours, i + 1);
      updateVariantStatusStmt.run("winner", score.variant_id);
      totalWinners++;
    }

    // Mark dead (bottom 50%)
    for (let i = bottom50PercentStart; i < clipScores.length; i++) {
      const score = clipScores[i];
      updateVariantStatusStmt.run("dead", score.variant_id);
      totalDead++;
    }
  }

  console.log(
    `[WINNERS] Selected ${totalWinners} winners and marked ${totalDead} as dead for snapshot=${snapshotHours}h`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let snapshotHours = 24;

  for (const arg of args) {
    if (arg.startsWith("--snapshot=")) {
      snapshotHours = parseInt(arg.split("=")[1], 10);
      break;
    }
  }

  await selectWinners(snapshotHours);
}

main().catch(console.error);

