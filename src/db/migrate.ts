import { db } from "./db.js";
import { initSchema } from "./schema.js";
import fs from "fs/promises";
import path from "path";

// This will recreate the schema with all new columns and constraints
// WARNING: This will lose all existing data
export async function migrateDatabase(): Promise<void> {
  const dbPath = path.join(process.cwd(), "data", "app.db");
  
  // Backup existing database
  try {
    await fs.access(dbPath);
    const backupPath = `${dbPath}.backup.${Date.now()}`;
    await fs.copyFile(dbPath, backupPath);
    console.log(`[MIGRATE] Backed up existing database to ${backupPath}`);
  } catch {
    // No existing database
  }

  // Drop all tables (in reverse order of dependencies)
  db.exec(`
    DROP TABLE IF EXISTS winners;
    DROP TABLE IF EXISTS scores;
    DROP TABLE IF EXISTS metrics;
    DROP TABLE IF EXISTS posts;
    DROP TABLE IF EXISTS captions;
    DROP TABLE IF EXISTS variants;
    DROP TABLE IF EXISTS hooks;
    DROP TABLE IF EXISTS clips;
    DROP TABLE IF EXISTS videos;
    DROP TABLE IF EXISTS experiments;
    DROP TABLE IF EXISTS jobs;
  `);

  // Recreate schema
  initSchema();
  console.log("[MIGRATE] Database migrated successfully");
}

if (require.main === module) {
  migrateDatabase().catch(console.error);
}


