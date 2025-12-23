import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";

initSchema();

async function markPosted(
  variantId: number,
  platform: string,
  url?: string
): Promise<void> {
  // Verify variant exists
  const variant = db
    .prepare("SELECT id FROM variants WHERE id = ?")
    .get(variantId) as { id: number } | undefined;

  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  const now = new Date().toISOString();

  const stmt = db.prepare(
    "INSERT INTO posts (variant_id, platform, posted_at, url_optional) VALUES (?, ?, ?, ?)"
  );

  stmt.run(variantId, platform, now, url || null);

  console.log(
    `[UI] Variant ${variantId} marked as posted on ${platform} at ${now}${url ? ` (${url})` : ""}`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let variantId: number | null = null;
  let platform: string | null = null;
  let url: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--variant_id=")) {
      variantId = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--platform=")) {
      platform = arg.split("=")[1];
    } else if (arg.startsWith("--url=")) {
      url = arg.split("=")[1];
    } else if (arg === "--variant_id" && args[args.indexOf(arg) + 1]) {
      variantId = parseInt(args[args.indexOf(arg) + 1], 10);
    } else if (arg === "--platform" && args[args.indexOf(arg) + 1]) {
      platform = args[args.indexOf(arg) + 1];
    } else if (arg === "--url" && args[args.indexOf(arg) + 1]) {
      url = args[args.indexOf(arg) + 1];
    }
  }

  if (!variantId || isNaN(variantId) || !platform) {
    console.error(
      "[UI] Usage: npm run post -- --variant_id=<id> --platform=<tiktok|instagram|youtube> [--url=<url>]"
    );
    process.exit(1);
  }

  await markPosted(variantId, platform, url);
}

main().catch(console.error);


