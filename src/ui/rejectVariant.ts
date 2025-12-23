import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";

initSchema();

async function rejectVariant(variantId: number): Promise<void> {
  // Verify variant exists
  const variant = db
    .prepare("SELECT id, status FROM variants WHERE id = ?")
    .get(variantId) as { id: number; status: string } | undefined;

  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  const stmt = db.prepare("UPDATE variants SET status = ? WHERE id = ?");
  stmt.run("rejected", variantId);

  console.log(`[UI] Variant ${variantId} rejected (was: ${variant.status})`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let variantId: number | null = null;

  for (const arg of args) {
    if (arg.startsWith("--variant_id=")) {
      variantId = parseInt(arg.split("=")[1], 10);
      break;
    } else if (arg === "--variant_id" && args[args.indexOf(arg) + 1]) {
      variantId = parseInt(args[args.indexOf(arg) + 1], 10);
      break;
    }
  }

  if (!variantId || isNaN(variantId)) {
    console.error("[UI] Usage: npm run reject -- --variant_id=<id>");
    process.exit(1);
  }

  await rejectVariant(variantId);
}

main().catch(console.error);


