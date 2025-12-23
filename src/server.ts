import express from "express";
import path from "path";
import { db } from "./db/db.js";
import { initSchema } from "./db/schema.js";
import { enqueueJob } from "./jobs/queue.js";

initSchema();

const app = express();
const PORT = 3000;

app.use(express.json());

// Serve static files
app.use("/working", express.static(path.join(process.cwd(), "working")));
app.use("/raw", express.static(path.join(process.cwd(), "raw")));

// API endpoints

app.get("/api/counts", (req, res) => {
  const counts = {
    videos: (db.prepare("SELECT COUNT(*) as count FROM videos").get() as { count: number }).count,
    clips: (db.prepare("SELECT COUNT(*) as count FROM clips").get() as { count: number }).count,
    hooks: (db.prepare("SELECT COUNT(*) as count FROM hooks").get() as { count: number }).count,
    variants: (db.prepare("SELECT COUNT(*) as count FROM variants").get() as { count: number }).count,
    posts: (db.prepare("SELECT COUNT(*) as count FROM posts").get() as { count: number }).count,
    jobs_pending: (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get() as { count: number }).count,
    jobs_running: (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").get() as { count: number }).count,
  };
  res.json(counts);
});

app.get("/api/jobs/status", (req, res) => {
  const jobs = db
    .prepare(`
      SELECT job_type, status, COUNT(*) as count 
      FROM jobs 
      WHERE status IN ('pending', 'running')
      GROUP BY job_type, status
      ORDER BY job_type, status
    `)
    .all() as Array<{ job_type: string; status: string; count: number }>;

  const summary = {
    pending: (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'").get() as { count: number }).count,
    running: (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'running'").get() as { count: number }).count,
    total: (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status IN ('pending', 'running')").get() as { count: number }).count,
    by_type: jobs.reduce((acc: any, job) => {
      if (!acc[job.job_type]) acc[job.job_type] = {};
      acc[job.job_type][job.status] = job.count;
      return acc;
    }, {}),
  };

  res.json(summary);
});

app.get("/api/variants", (req, res) => {
  const status = req.query.status as string | undefined;
  let query = `
    SELECT 
      v.id,
      v.clip_id,
      v.filepath_variant,
      v.status,
      v.generation,
      v.created_at,
      h.hook_text,
      COUNT(DISTINCT c.id) as caption_count,
      COUNT(DISTINCT p.id) as post_count
    FROM variants v
    JOIN hooks h ON v.hook_id = h.id
    LEFT JOIN captions c ON v.id = c.variant_id
    LEFT JOIN posts p ON v.id = p.variant_id
  `;

  const params: any[] = [];
  if (status) {
    query += " WHERE v.status = ?";
    params.push(status);
  }

  query += " GROUP BY v.id ORDER BY v.created_at DESC LIMIT 100";

  const variants = db.prepare(query).all(...params);
  res.json(variants);
});

app.get("/api/postpacks", (req, res) => {
  const postpacks = db
    .prepare(
      `SELECT 
        v.id as variant_id,
        v.filepath_variant,
        h.hook_text,
        GROUP_CONCAT(c.caption_text, ' ||| ') as captions
      FROM variants v
      JOIN hooks h ON v.hook_id = h.id
      LEFT JOIN captions c ON v.id = c.variant_id
      WHERE v.status = 'generated'
      GROUP BY v.id
      ORDER BY v.created_at DESC
      LIMIT 50`
    )
    .all() as Array<{
    variant_id: number;
    filepath_variant: string;
    hook_text: string;
    captions: string | null;
  }>;

  const result = postpacks.map((p) => ({
    variant_id: p.variant_id,
    filepath_variant: p.filepath_variant,
    hook_text: p.hook_text,
    captions: p.captions ? p.captions.split(" ||| ") : [],
  }));

  res.json(result);
});

app.post("/api/variants/:id/approve", (req, res) => {
  const variantId = parseInt(req.params.id, 10);
  db.prepare("UPDATE variants SET status = 'approved' WHERE id = ?").run(variantId);
  res.json({ success: true, variant_id: variantId, status: "approved" });
});

app.post("/api/variants/:id/reject", (req, res) => {
  const variantId = parseInt(req.params.id, 10);
  db.prepare("UPDATE variants SET status = 'rejected' WHERE id = ?").run(variantId);
  res.json({ success: true, variant_id: variantId, status: "rejected" });
});

app.post("/api/variants/:id/posted", (req, res) => {
  const variantId = parseInt(req.params.id, 10);
  const { platform, url } = req.body;

  if (!platform) {
    res.status(400).json({ error: "platform is required" });
    return;
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO posts (variant_id, platform, posted_at, url_optional) VALUES (?, ?, ?, ?)"
  );
  const result = stmt.run(variantId, platform, now, url || null);
  const postId = Number(result.lastInsertRowid);

  db.prepare("UPDATE variants SET status = 'posted' WHERE id = ?").run(variantId);

  res.json({ success: true, variant_id: variantId, post_id: postId, status: "posted" });
});

app.post("/api/posts/:id/metrics", (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const { snapshot_hours, views, likes, comments, saves } = req.body;

  if (!snapshot_hours) {
    res.status(400).json({ error: "snapshot_hours is required" });
    return;
  }

  const stmt = db.prepare(
    "INSERT INTO metrics (post_id, snapshot_hours, views, likes, comments, saves) VALUES (?, ?, ?, ?, ?, ?)"
  );
  stmt.run(
    postId,
    snapshot_hours,
    views || 0,
    likes || 0,
    comments || 0,
    saves || 0
  );

  // Enqueue score job
  enqueueJob("score", "post", postId);

  res.json({ success: true, post_id: postId });
});

app.post("/api/clear", async (req, res) => {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");

    // Delete variant files
    const variantsDir = path.join(process.cwd(), "working", "variants");
    try {
      const files = await fs.readdir(variantsDir);
      for (const file of files) {
        await fs.unlink(path.join(variantsDir, file));
      }
    } catch {}

    // Delete postpack directories
    const postpacksDir = path.join(process.cwd(), "working", "postpacks");
    try {
      const dirs = await fs.readdir(postpacksDir);
      for (const dir of dirs) {
        await fs.rm(path.join(postpacksDir, dir), { recursive: true, force: true });
      }
    } catch {}

    // Clear database entries (keep videos and clips, only clear generated content)
    db.exec(`
      DELETE FROM captions;
      DELETE FROM variants;
      DELETE FROM posts;
      DELETE FROM metrics;
      DELETE FROM scores;
      DELETE FROM winners;
      DELETE FROM hooks;
      DELETE FROM jobs WHERE job_type IN ('render', 'gen_captions', 'postpack', 'gen_hooks');
    `);

    res.json({ success: true, message: "Videos and variants cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/regenerate", (req, res) => {
  try {
    // Get all clips (not just ones with hooks, so we can regenerate hooks too)
    const clips = db
      .prepare("SELECT id FROM clips")
      .all() as Array<{ id: number }>;

    let genHooksJobs = 0;
    let renderJobs = 0;

    for (const { id: clip_id } of clips) {
      // Check if clip has hooks
      const hookCount = db
        .prepare("SELECT COUNT(*) as count FROM hooks WHERE clip_id = ?")
        .get(clip_id) as { count: number };

      if (hookCount.count === 0) {
        // No hooks, enqueue gen_hooks first
        enqueueJob("gen_hooks", "clip", clip_id);
        genHooksJobs++;
      } else {
        // Has hooks, enqueue render
        enqueueJob("render", "clip", clip_id);
        renderJobs++;
      }
    }

    const totalJobs = genHooksJobs + renderJobs;

    res.json({ 
      success: true, 
      message: `Regeneration started: ${genHooksJobs} hook generation jobs, ${renderJobs} render jobs`,
      gen_hooks_jobs: genHooksJobs,
      render_jobs: renderJobs,
      total_jobs: totalJobs
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Serve dashboard HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "src", "server", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🎬 Viral Reel Creator Dashboard: http://localhost:${PORT}\n`);
});

