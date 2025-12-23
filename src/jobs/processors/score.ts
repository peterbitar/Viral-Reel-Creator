import { db } from "../../db/db.js";
import { initSchema } from "../../db/schema.js";
import { loadConfig } from "../../config/loader.js";

initSchema();

export async function processScoreJob(postId: number): Promise<void> {
  const post = db
    .prepare("SELECT id FROM posts WHERE id = ?")
    .get(postId) as { id: number } | undefined;

  if (!post) {
    throw new Error(`Post not found: ${postId}`);
  }

  // Get latest metrics for this post (most recent snapshot)
  const metrics = db
    .prepare(
      "SELECT id, post_id, snapshot_hours, views, likes, comments, saves FROM metrics WHERE post_id = ? ORDER BY snapshot_hours DESC LIMIT 1"
    )
    .get(postId) as {
    id: number;
    post_id: number;
    snapshot_hours: number;
    views: number;
    likes: number;
    comments: number;
    saves: number;
  } | undefined;

  if (!metrics) {
    console.warn(`[SCORE] No metrics found for post_id=${postId}`);
    return;
  }

  const config = await loadConfig();
  const weights = config.score_weights;

  // Compute score
  const score =
    metrics.views * weights.views +
    metrics.saves * weights.saves +
    metrics.comments * weights.comments;

  // Check if score already exists for this snapshot
  const existing = db
    .prepare(
      "SELECT id FROM scores WHERE post_id = ? AND snapshot_hours = ?"
    )
    .get(postId, metrics.snapshot_hours) as { id: number } | undefined;

  if (!existing) {
    const insertStmt = db.prepare(
      "INSERT INTO scores (post_id, snapshot_hours, score_value) VALUES (?, ?, ?)"
    );
    insertStmt.run(postId, metrics.snapshot_hours, score);
    console.log(
      `[SCORE] Computed score=${score.toFixed(2)} for post_id=${postId}, snapshot=${metrics.snapshot_hours}h`
    );
  } else {
    console.log(`[SCORE] Score already exists for post_id=${postId}, snapshot=${metrics.snapshot_hours}h`);
  }
}


