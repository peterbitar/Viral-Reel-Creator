import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";

initSchema();

async function addMetrics(
  postId: number,
  snapshotHours: number,
  views: number,
  likes: number,
  comments: number,
  saves: number
): Promise<void> {
  // Verify post exists
  const post = db
    .prepare("SELECT id FROM posts WHERE id = ?")
    .get(postId) as { id: number } | undefined;

  if (!post) {
    throw new Error(`Post not found: ${postId}`);
  }

  const stmt = db.prepare(
    "INSERT INTO metrics (post_id, snapshot_hours, views, likes, comments, saves) VALUES (?, ?, ?, ?, ?, ?)"
  );

  stmt.run(postId, snapshotHours, views, likes, comments, saves);

  console.log(
    `[METRICS] Added metrics for post_id=${postId}, snapshot=${snapshotHours}h: views=${views}, likes=${likes}, comments=${comments}, saves=${saves}`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let postId: number | null = null;
  let snapshotHours: number | null = null;
  let views = 0;
  let likes = 0;
  let comments = 0;
  let saves = 0;

  for (const arg of args) {
    if (arg.startsWith("--post_id=")) {
      postId = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--snapshot=")) {
      snapshotHours = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--views=")) {
      views = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--likes=")) {
      likes = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--comments=")) {
      comments = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--saves=")) {
      saves = parseInt(arg.split("=")[1], 10);
    }
  }

  if (!postId || isNaN(postId) || !snapshotHours || isNaN(snapshotHours)) {
    console.error(
      "[METRICS] Usage: npm run metrics -- --post_id=<id> --snapshot=<hours> [--views=<n>] [--likes=<n>] [--comments=<n>] [--saves=<n>]"
    );
    process.exit(1);
  }

  await addMetrics(postId, snapshotHours, views, likes, comments, saves);
}

main().catch(console.error);


