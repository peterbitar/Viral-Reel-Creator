import { execSync } from 'child_process';
import fs from 'fs';

// Import using dynamic import for TypeScript module
async function importLLM() {
  const module = await import('../src/llm/client.ts');
  return module.llmJson;
}

async function testVariantWithLLM(variantPath, llmJson) {
  if (!fs.existsSync(variantPath)) {
    console.log(`❌ Variant not found: ${variantPath}`);
    return null;
  }

  // Create a screenshot with boundary markers
  const height = parseInt(execSync(`ffprobe -v error -show_entries stream=height -of csv=s=x:p=0 "${variantPath}"`).toString().trim());
  const width = parseInt(execSync(`ffprobe -v error -show_entries stream=width -of csv=s=x:p=0 "${variantPath}"`).toString().trim());
  
  const startY = Math.round(height * 0.17);
  const boundaryY = Math.round(height * 0.40);
  const screenshotPath = `/tmp/test_${Date.now()}.jpg`;
  
  const vf = `drawbox=x=0:y=${startY}:w=${width}:h=2:color=green@0.8:t=fill,drawbox=x=0:y=${boundaryY}:w=${width}:h=3:color=red@0.9:t=fill,scale=540:-1`;
  
  execSync(`ffmpeg -i "${variantPath}" -ss 1 -vf "${vf}" -frames:v 1 -y "${screenshotPath}" 2>/dev/null`);
  
  // Get expected hook text
  const hookText = execSync(`sqlite3 data/app.db "SELECT h.hook_text FROM variants v JOIN hooks h ON v.hook_id = h.id WHERE v.filepath_variant = '${variantPath}' LIMIT 1;"`).toString().trim();
  
  const prompt = `Look at this screenshot of a video with text overlay. I've added green and red lines as markers:
- GREEN line at 17% from top: This is where the text should START
- RED line at 40% from top: This is the MAXIMUM limit - text should NOT extend below this line

The expected hook text should be: "${hookText}"

Please analyze the screenshot and check:

1. **Text Wrapping**: Does the text wrap to multiple lines correctly? Or is it showing on a single line? Are there any literal "n" characters appearing where line breaks should be (like "wordnword" instead of proper line breaks)?

2. **Vertical Bounds**: Is ALL of the text between the green line (17%) and red line (40%)? Or does any part of the text extend below the red line (exceeding the 40% limit)?

3. **Text Content**: Can you read what text is actually displayed? Does it match the expected hook text, or are there any issues?

Return JSON with:
{
  "text_readable": "the text you can see in the image",
  "wraps_correctly": true/false,
  "has_literal_n": true/false (if you see "n" characters where line breaks should be),
  "within_bounds": true/false (all text between green and red lines),
  "exceeds_below_red": true/false (any text below red line),
  "issues": ["list of any issues found"]
}`;

  try {
    const result = await llmJson(prompt, [screenshotPath]);
    
    // Cleanup
    try { fs.unlinkSync(screenshotPath); } catch {}
    
    return {
      variant: variantPath.split('/').pop(),
      hookText,
      ...result
    };
  } catch (error) {
    try { fs.unlinkSync(screenshotPath); } catch {}
    return {
      variant: variantPath.split('/').pop(),
      hookText,
      error: error.message
    };
  }
}

async function main() {
  console.log('🤖 Testing variants with LLM Vision Analysis...\n');
  
  // Import LLM function
  const llmJson = await importLLM();
  
  // Get latest 3 variants
  const variants = execSync('sqlite3 data/app.db "SELECT filepath_variant FROM variants ORDER BY id DESC LIMIT 3;"')
    .toString()
    .trim()
    .split('\n')
    .filter(v => v && fs.existsSync(v));
  
  if (variants.length === 0) {
    console.log('❌ No variants found');
    process.exit(1);
  }
  
  console.log(`📸 Analyzing ${variants.length} variants...\n`);
  
  const results = [];
  for (const variant of variants) {
    const result = await testVariantWithLLM(variant, llmJson);
    if (result) {
      results.push(result);
    }
  }
  
  console.log('📊 Analysis Results:\n');
  console.log('='.repeat(60));
  
  let allPass = true;
  results.forEach((result, idx) => {
    console.log(`\n📸 Variant ${idx + 1}: ${result.variant}`);
    console.log(`   Expected: "${result.hookText}"`);
    
    if (result.error) {
      console.log(`   ❌ Error: ${result.error}`);
      allPass = false;
    } else {
      console.log(`   Text visible: "${result.text_readable || 'N/A'}"`);
      console.log(`   Wraps correctly: ${result.wraps_correctly ? '✅' : '❌'}`);
      console.log(`   Has literal "n": ${result.has_literal_n ? '❌ YES (ISSUE!)' : '✅ No'}`);
      console.log(`   Within bounds: ${result.within_bounds ? '✅' : '❌'}`);
      console.log(`   Exceeds below red: ${result.exceeds_below_red ? '❌ YES (ISSUE!)' : '✅ No'}`);
      
      if (result.issues && result.issues.length > 0) {
        console.log(`   Issues: ${result.issues.join(', ')}`);
        allPass = false;
      }
      
      if (!result.wraps_correctly || result.has_literal_n || !result.within_bounds || result.exceeds_below_red) {
        allPass = false;
      }
    }
    console.log('-'.repeat(60));
  });
  
  console.log('\n📋 Summary:');
  if (allPass) {
    console.log('✅ All tests passed! Text wrapping and bounds are correct.');
    process.exit(0);
  } else {
    console.log('❌ Issues found - please review the results above.');
    process.exit(1);
  }
}

main().catch(console.error);

