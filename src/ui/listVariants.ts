import { db } from "../db/db.js";
import { initSchema } from "../db/schema.js";

initSchema();

interface VariantInfo {
  variant_id: number;
  clip_id: number;
  hook_text: string;
  filepath_variant: string;
  status: string;
  caption_count: number;
  caption_texts: string[];
  created_at: string;
}

async function listVariants(statusFilter?: string): Promise<void> {
  let query = `
    SELECT 
      v.id as variant_id,
      v.clip_id,
      h.hook_text,
      v.filepath_variant,
      v.status,
      v.created_at,
      COUNT(DISTINCT c.id) as caption_count,
      GROUP_CONCAT(c.caption_text, ' | ') as caption_texts
    FROM variants v
    JOIN hooks h ON v.hook_id = h.id
    LEFT JOIN captions c ON v.id = c.variant_id
  `;

  const params: any[] = [];

  if (statusFilter) {
    query += " WHERE v.status = ?";
    params.push(statusFilter);
  }

  query += " GROUP BY v.id ORDER BY v.created_at DESC";

  const variants = db.prepare(query).all(...params) as Array<{
    variant_id: number;
    clip_id: number;
    hook_text: string;
    filepath_variant: string;
    status: string;
    created_at: string;
    caption_count: number;
    caption_texts: string | null;
  }>;

  if (variants.length === 0) {
    console.log("[UI] No variants found" + (statusFilter ? ` with status: ${statusFilter}` : ""));
    return;
  }

  console.log(`\n[UI] Found ${variants.length} variant(s):\n`);
  console.log("=".repeat(100));

  for (const variant of variants) {
    const captions = variant.caption_texts ? variant.caption_texts.split(" | ") : [];
    
    console.log(`\nVariant ID: ${variant.variant_id}`);
    console.log(`Clip ID: ${variant.clip_id}`);
    console.log(`Status: ${variant.status}`);
    console.log(`Hook: "${variant.hook_text}"`);
    console.log(`Video: ${variant.filepath_variant}`);
    console.log(`Created: ${variant.created_at}`);
    console.log(`Captions (${variant.caption_count}):`);
    
    if (captions.length > 0) {
      captions.forEach((caption, idx) => {
        console.log(`  ${idx + 1}. ${caption}`);
        console.log(`     Copy: pbcopy <<< "${caption.replace(/"/g, '\\"')}" || echo "${caption}"`);
      });
    } else {
      console.log("  (No captions generated yet)");
    }

    // Check if posted
    const posts = db
      .prepare("SELECT platform, posted_at, url_optional FROM posts WHERE variant_id = ?")
      .all(variant.variant_id) as Array<{
      platform: string;
      posted_at: string | null;
      url_optional: string | null;
    }>;

    if (posts.length > 0) {
      console.log(`Posted:`);
      posts.forEach((post) => {
        console.log(`  - ${post.platform} at ${post.posted_at || "unknown"}${post.url_optional ? ` (${post.url_optional})` : ""}`);
      });
    }

    console.log(`\nCommands:`);
    console.log(`  Approve:  npm run approve -- --variant_id=${variant.variant_id}`);
    console.log(`  Reject:   npm run reject -- --variant_id=${variant.variant_id}`);
    console.log(`  Post:     npm run post -- --variant_id=${variant.variant_id} --platform=tiktok`);
    console.log(`  View:     open "${variant.filepath_variant}"`);
    console.log("-".repeat(100));
  }

  console.log("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let statusFilter: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--status=")) {
      statusFilter = arg.split("=")[1];
      break;
    } else if (arg === "--status" && args[args.indexOf(arg) + 1]) {
      statusFilter = args[args.indexOf(arg) + 1];
      break;
    }
  }

  await listVariants(statusFilter);
}

main().catch(console.error);


