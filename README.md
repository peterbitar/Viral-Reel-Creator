# Viral Reel Creator - Production-Grade Evolutionary Content Factory

A microprocessing factory for generating viral reel variants with AI-generated hooks and captions, featuring evolutionary learning and job queue architecture.

## Architecture Overview

This system uses a **jobs queue architecture** where each microprocess:
1. Processes ONE job at a time
2. Creates the next job(s) in the pipeline by enqueueing them
3. Is idempotent (can be run multiple times safely via UNIQUE constraints)
4. Tracks evolution through experiments and generations

### Key Features

- **Experiments & Generations**: Track evolutionary lineage of content
- **Idempotency**: UNIQUE constraints prevent duplicates
- **Job Queue**: Microprocess execution via jobs table
- **Evolutionary Learning**: Winners spawn next-generation variants
- **Real-time Dashboard**: Visual UI with auto-refresh

## Prerequisites

- Node.js 18+
- FFmpeg (installed and available in PATH)
  - Verify: `ffmpeg -version` and `ffprobe -version`
- OpenAI API key (or other LLM provider)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Migrate database (creates schema with experiments, generations, jobs):
   ```bash
   npm run migrate
   ```

3. Create `.env` file:
   ```
   OPENAI_API_KEY=sk-your-key-here
   ```

4. Configure experiment in `config/default.json`:
   ```json
   {
     "active_experiment": "cats_crunch_dec22",
     "niche": "cats",
     "region": "CA",
     "clip_length_sec": 9,
     "overlap_sec": 1,
     "hooks_per_clip": 30,
     "captions_per_variant": 3,
     "score_weights": {
       "views": 1,
       "saves": 5,
       "comments": 3
     },
     "winner_top_pct": 0.2,
     "dead_bottom_pct": 0.5
   }
   ```

## Usage

### Quick Start: Full Pipeline

1. **Start the job worker** (processes pending jobs continuously):
   ```bash
   npm run worker
   ```

2. **Start the file watcher** (watches `/raw` for new videos):
   ```bash
   npm run ingest
   ```

3. **Drop videos in `/raw` directory**

4. **Watch the dashboard** at http://localhost:3000:
   ```bash
   npm run server
   ```

The worker will automatically process: ingest → slice → gen_hooks → render → gen_captions → postpack

### Manual Job Processing

Process a single job of a specific type:
```bash
npm run job -- slice
npm run job -- gen_hooks
npm run job -- render
# etc.
```

Process ALL pending jobs of any type (one at a time):
```bash
npm run job
```

### Processing Flow

1. **Ingest** (`ingest`): Watches `/raw`, creates video row, enqueues `slice` job
2. **Slice** (`slice`): Creates clips, enqueues `gen_hooks` for each clip
3. **Generate Hooks** (`gen_hooks`): LLM generates 30 hooks, enqueues `render` job
4. **Render** (`render`): Creates variants with text overlays, enqueues `gen_captions` + `postpack`
5. **Generate Captions** (`gen_captions`): LLM generates 3 captions per variant
6. **Create Postpack** (`postpack`): Assembles folder with video + captions + metadata

### Performance & Evolution Flow

7. **Post Variant**: Use dashboard to mark as posted on platform
8. **Add Metrics**: POST `/api/posts/:id/metrics` with views/likes/comments/saves
9. **Compute Scores** (`score`): Calculates score = views + saves*5 + comments*3
10. **Select Winners** (`select_winners`): Top 20% = winners, bottom 50% = dead, enqueues `mutate` for winners
11. **Mutate** (`mutate`): Generates generation+1 variants from winning hooks

### Dashboard Endpoints

- `GET /api/counts` - Stats (videos, clips, hooks, variants, posts, pending jobs)
- `GET /api/variants?status=generated` - List variants with hook text and previews
- `GET /api/postpacks` - List ready-to-post packages
- `POST /api/variants/:id/approve` - Approve variant
- `POST /api/variants/:id/reject` - Reject variant
- `POST /api/variants/:id/posted` - Mark as posted (body: `{platform, url?}`)
- `POST /api/posts/:id/metrics` - Add metrics (body: `{snapshot_hours, views, likes, comments, saves}`)

## Database Schema

### Core Tables
- `experiments` - Experiment tracking (name, niche, region)
- `videos` - Raw video files (UNIQUE filepath_raw)
- `clips` - Sliced segments (UNIQUE video_id + start_sec + end_sec)
- `hooks` - AI-generated hook text (UNIQUE clip_id + hook_text)
- `variants` - Rendered videos with hooks (UNIQUE clip_id + hook_id + overlay_style)
- `captions` - AI-generated captions
- `posts` - Platform posting records
- `metrics` - Performance metrics (views, likes, comments, saves)
- `scores` - Computed scores
- `winners` - Top performing variants
- `jobs` - Job queue (pending → running → done/failed)

### Evolution Tracking
- `hooks.generation` - Generation number (1 = initial, 2+ = mutated)
- `hooks.parent_hook_id` - Links to original hook
- `hooks.source` - "auto" or "mutated"
- `variants.generation` - Generation number
- `variants.parent_variant_id` - Links to parent variant

## Configuration

Edit `config/default.json`:

```json
{
  "active_experiment": "cats_crunch_dec22",
  "niche": "cats",
  "region": "CA",
  "clip_length_sec": 9,
  "overlap_sec": 1,
  "hooks_per_clip": 30,
  "captions_per_variant": 3,
  "score_weights": {
    "views": 1,
    "saves": 5,
    "comments": 3
  },
  "winner_top_pct": 0.2,
  "dead_bottom_pct": 0.5
}
```

## Workflow Example

```bash
# Terminal 1: Start worker
npm run worker

# Terminal 2: Start file watcher
npm run ingest

# Terminal 3: Start dashboard
npm run server

# Drop video.mp4 into /raw directory
# Worker automatically processes:
# 1. Ingest → creates video row → enqueues slice
# 2. Slice → creates 5 clips → enqueues 5 gen_hooks jobs
# 3. Gen_hooks → creates 30 hooks → enqueues render
# 4. Render → creates 30 variants → enqueues gen_captions + postpack
# 5. Gen_captions → creates 3 captions per variant
# 6. Postpack → creates ready-to-post folders

# View in dashboard at http://localhost:3000
# Approve variants → Mark as posted → Enter metrics
# Run: npm run job -- select_winners
# Run: npm run job -- mutate (for generation 2)
```

## Idempotency

All operations are idempotent thanks to UNIQUE constraints:
- Same video file → uses existing video row
- Same clip boundaries → uses existing clip row
- Same hook text → uses existing hook row
- Same variant → uses existing variant row

Running jobs multiple times is safe and won't create duplicates.

## Acceptance Criteria ✅

1. ✅ Drop file in `/raw` → ingest job → video row → slice job enqueued
2. ✅ Slice job creates clips → enqueues gen_hooks per clip
3. ✅ Gen_hooks creates hooks → enqueues render
4. ✅ Render creates variants → enqueues captions + postpacks
5. ✅ Dashboard shows variants with preview video + hook
6. ✅ Mark posted + enter metrics → score computed
7. ✅ Select_winners marks winners/dead correctly by clip_id group
8. ✅ Mutate generates generation 2 variants with parent linkage

## Directory Structure

```
/raw                    # Drop raw videos here
/working
  /clips               # Generated video clips
  /variants            # Rendered variants with hooks
  /postpacks           # Ready-to-post packages
/data
  app.db               # SQLite database
/config
  default.json         # Configuration
```

## V1 Definition of Done

✅ Drop raw videos → outputs many postpacks with different hooks  
✅ Mark posted on TikTok/IG manually  
✅ Enter metrics at 6h/24h  
✅ Auto-select winners and generate next-gen variants  
✅ Experiments & generations tracking  
✅ Idempotent job queue system  
✅ Real-time dashboard
