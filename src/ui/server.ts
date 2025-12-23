import express from "express";
import path from "path";
import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";

initSchema();

const app = express();
const PORT = 3000;

// Serve static files from working directories
app.use("/clips", express.static(path.join(process.cwd(), "working", "clips")));
app.use("/variants", express.static(path.join(process.cwd(), "working", "variants")));
app.use("/postpacks", express.static(path.join(process.cwd(), "working", "postpacks")));
app.use("/raw", express.static(path.join(process.cwd(), "raw")));

// API endpoints
app.get("/api/stats", (req, res) => {
  const stats = {
    videos: db.prepare("SELECT COUNT(*) as count FROM videos").get() as { count: number },
    clips: db.prepare("SELECT COUNT(*) as count FROM clips").get() as { count: number },
    hooks: db.prepare("SELECT COUNT(*) as count FROM hooks").get() as { count: number },
    variants: db.prepare("SELECT COUNT(*) as count FROM variants").get() as { count: number },
    captions: db.prepare("SELECT COUNT(*) as count FROM captions").get() as { count: number },
    postpacks: db.prepare("SELECT COUNT(*) as count FROM variants").get() as { count: number }, // Approximate
    approved: db.prepare("SELECT COUNT(*) as count FROM variants WHERE status = 'approved'").get() as { count: number },
    posted: db.prepare("SELECT COUNT(*) as count FROM posts").get() as { count: number },
  };

  res.json(stats);
});

app.get("/api/videos", (req, res) => {
  const videos = db
    .prepare("SELECT id, filepath_raw, duration_sec, created_at FROM videos ORDER BY created_at DESC")
    .all();
  res.json(videos);
});

app.get("/api/clips", (req, res) => {
  const clips = db
    .prepare(`
      SELECT c.id, c.video_id, c.filepath_clip, c.start_sec, c.end_sec, c.created_at,
             v.filepath_raw as video_filepath,
             COUNT(DISTINCT h.id) as hook_count,
             COUNT(DISTINCT var.id) as variant_count
      FROM clips c
      JOIN videos v ON c.video_id = v.id
      LEFT JOIN hooks h ON c.id = h.clip_id
      LEFT JOIN variants var ON c.id = var.clip_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `)
    .all();
  res.json(clips);
});

app.get("/api/variants", (req, res) => {
  const variants = db
    .prepare(`
      SELECT v.id, v.clip_id, v.filepath_variant, v.status, v.created_at,
             h.hook_text,
             COUNT(DISTINCT c.id) as caption_count,
             COUNT(DISTINCT p.id) as post_count
      FROM variants v
      JOIN hooks h ON v.hook_id = h.id
      LEFT JOIN captions c ON v.id = c.variant_id
      LEFT JOIN posts p ON v.id = p.variant_id
      GROUP BY v.id
      ORDER BY v.created_at DESC
      LIMIT 100
    `)
    .all();
  res.json(variants);
});

app.get("/api/posts", (req, res) => {
  const posts = db
    .prepare(`
      SELECT p.id, p.variant_id, p.platform, p.posted_at, p.url_optional,
             v.filepath_variant
      FROM posts p
      JOIN variants v ON p.variant_id = v.id
      ORDER BY p.posted_at DESC
    `)
    .all();
  res.json(posts);
});

// Serve the HTML page
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "src", "ui", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🎬 Viral Reel Creator UI running at: http://localhost:${PORT}\n`);
});

