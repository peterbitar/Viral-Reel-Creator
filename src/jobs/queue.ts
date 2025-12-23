import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";

initSchema();

export type JobType =
  | "ingest"
  | "slice"
  | "gen_hooks"
  | "render"
  | "gen_captions"
  | "postpack"
  | "score"
  | "select_winners"
  | "mutate";

export type EntityType = "video" | "clip" | "variant" | "post" | "experiment";

export interface Job {
  id: number;
  job_type: JobType;
  entity_type: EntityType;
  entity_id: number;
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function enqueueJob(
  jobType: JobType,
  entityType: EntityType,
  entityId: number
): number {
  const stmt = db.prepare(
    "INSERT INTO jobs (job_type, entity_type, entity_id, status) VALUES (?, ?, ?, 'pending')"
  );
  const result = stmt.run(jobType, entityType, entityId);
  return Number(result.lastInsertRowid);
}

export function getNextPendingJob(jobType?: JobType): Job | null {
  let query = "SELECT * FROM jobs WHERE status = 'pending'";
  const params: any[] = [];

  if (jobType) {
    query += " AND job_type = ?";
    params.push(jobType);
  }

  query += " ORDER BY created_at ASC LIMIT 1";

  const job = db.prepare(query).get(...params) as Job | undefined;
  return job || null;
}

export function markJobRunning(jobId: number): void {
  const stmt = db.prepare(
    "UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?"
  );
  stmt.run(jobId);
}

export function markJobDone(jobId: number): void {
  const stmt = db.prepare(
    "UPDATE jobs SET status = 'done', updated_at = datetime('now') WHERE id = ?"
  );
  stmt.run(jobId);
}

export function markJobFailed(jobId: number, error: string): void {
  const stmt = db.prepare(
    "UPDATE jobs SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?"
  );
  stmt.run(error, jobId);
}

export function getPendingJobsByType(jobType: JobType): Job[] {
  return db
    .prepare("SELECT * FROM jobs WHERE status = 'pending' AND job_type = ? ORDER BY created_at ASC")
    .all(jobType) as Job[];
}


