import fs from "fs/promises";
import path from "path";

interface Config {
  active_experiment: string;
  niche?: string;
  region?: string;
  clip_length_sec: number;
  overlap_sec: number;
  hooks_per_clip: number;
  captions_per_variant: number;
  score_weights: {
    views: number;
    saves: number;
    comments: number;
  };
  winner_top_pct: number;
  dead_bottom_pct: number;
}

const defaultConfig: Config = {
  active_experiment: "default",
  clip_length_sec: 9,
  overlap_sec: 1,
  hooks_per_clip: 4,
  captions_per_variant: 3,
  score_weights: {
    views: 1,
    saves: 5,
    comments: 3,
  },
  winner_top_pct: 0.2,
  dead_bottom_pct: 0.5,
};

let cachedConfig: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const configPath = path.join(process.cwd(), "config", "default.json");
    const configData = await fs.readFile(configPath, "utf-8");
    const userConfig = JSON.parse(configData);
    cachedConfig = { ...defaultConfig, ...userConfig };
    return cachedConfig;
  } catch (error) {
    console.warn("[CONFIG] Using default config, could not load config file");
    cachedConfig = defaultConfig;
    return cachedConfig;
  }
}

