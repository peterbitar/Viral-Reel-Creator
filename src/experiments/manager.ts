import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";
import fs from "fs/promises";
import path from "path";

initSchema();

export async function getOrCreateExperiment(
  name: string,
  niche?: string,
  region?: string
): Promise<number> {
  // Try to get existing
  let experiment = db
    .prepare("SELECT id FROM experiments WHERE name = ?")
    .get(name) as { id: number } | undefined;

  if (experiment) {
    return experiment.id;
  }

  // Try to get from config
  if (!niche || !region) {
    try {
      const configPath = path.join(process.cwd(), "config", "default.json");
      const configData = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(configData);
      niche = niche || config.niche || null;
      region = region || config.region || null;
    } catch {
      // Config not found, use defaults
    }
  }

  // Create new
  const stmt = db.prepare(
    "INSERT INTO experiments (name, niche, region) VALUES (?, ?, ?)"
  );
  const result = stmt.run(name, niche, region);
  return Number(result.lastInsertRowid);
}

export async function getActiveExperiment(): Promise<number> {
  try {
    const configPath = path.join(process.cwd(), "config", "default.json");
    const configData = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(configData);
    const experimentName = config.active_experiment || "default";
    return await getOrCreateExperiment(experimentName, config.niche, config.region);
  } catch {
    return await getOrCreateExperiment("default");
  }
}


