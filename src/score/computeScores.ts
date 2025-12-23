import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";

initSchema();

interface MetricRow {
  id: number;
  post_id: number;
  snapshot_hours: number;
  views: number;
  likes: number;
  comments: number;
  saves: number;
}

function computeScore(views: number, saves: number, comments: number): number {
  // score = views + saves*5 + comments*3
  return views + saves * 5 + comments * 3;
}

async function computeScores(snapshotHours?: number): Promise<void> {
  let metrics: MetricRow[];

  if (snapshotHours !== undefined) {
    metrics = db
      .prepare(
        "SELECT id, post_id, snapshot_hours, views, likes, comments, saves FROM metrics WHERE snapshot_hours = ?"
      )
      .all(snapshotHours) as MetricRow[];
  } else {
    // Compute for all metrics that don't have scores yet
    metrics = db
      .prepare(
        `SELECT m.id, m.post_id, m.snapshot_hours, m.views, m.likes, m.comments, m.saves 
         FROM metrics m
         LEFT JOIN scores s ON m.post_id = s.post_id AND m.snapshot_hours = s.snapshot_hours
         WHERE s.id IS NULL`
      )
      .all() as MetricRow[];
  }

  if (metrics.length === 0) {
    console.log("[SCORE] No metrics found to compute scores for");
    return;
  }

  console.log(`[SCORE] Computing scores for ${metrics.length} metric entries...`);

  const insertStmt = db.prepare(
    "INSERT INTO scores (post_id, snapshot_hours, score_value) VALUES (?, ?, ?)"
  );

  for (const metric of metrics) {
    const score = computeScore(metric.views, metric.saves, metric.comments);

    insertStmt.run(metric.post_id, metric.snapshot_hours, score);

    console.log(
      `[SCORE] post_id=${metric.post_id}, snapshot=${metric.snapshot_hours}h: score=${score.toFixed(2)} (views=${metric.views}, saves=${metric.saves}, comments=${metric.comments})`
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let snapshotHours: number | undefined;

  for (const arg of args) {
    if (arg.startsWith("--snapshot=")) {
      snapshotHours = parseInt(arg.split("=")[1], 10);
      break;
    }
  }

  await computeScores(snapshotHours);
}

main().catch(console.error);


