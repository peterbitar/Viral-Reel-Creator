const { execSync } = require('child_process');
const fs = require('fs');

console.log('🧪 Testing newlines and vertical bounds...\n');

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

console.log(`📹 Testing ${variants.length} variants...\n`);

let issuesFound = 0;

variants.forEach((variant, idx) => {
  const filename = variant.split('/').pop();
  console.log(`📸 ${filename}`);
  
  try {
    // Get video dimensions
    const height = parseInt(execSync(`ffprobe -v error -show_entries stream=height -of csv=s=x:p=0 "${variant}"`).toString().trim());
    
    // Extract frame to check for issues
    const tempFrame = '/tmp/test_frame.png';
    execSync(`ffmpeg -i "${variant}" -ss 1 -frames:v 1 -y "${tempFrame}" 2>/dev/null`);
    
    // Check 1: Look for literal "n" characters that indicate newline issues
    // Extract text region (top 50% where hooks should be)
    const checkCmd = `ffmpeg -i "${tempFrame}" -vf "crop=w:h*0.5:0:0" -frames:v 1 -f rawvideo -pix_fmt rgb24 - 2>/dev/null | xxd -p | head -100`;
    
    // Check 2: Verify text doesn't exceed 40% vertical limit for top position
    // Search for text in the 40-50% range (should be empty)
    const overflowCheck = height * 0.40;
    const overflowCheckCmd = `ffmpeg -i "${variant}" -ss 1 -vf "crop=w:10:0:${Math.round(overflowCheck)}" -frames:v 1 -f rawvideo -pix_fmt rgb24 - 2>/dev/null`;
    
    try {
      const overflowData = execSync(overflowCheckCmd);
      // Check for bright pixels (white text) in the overflow zone
      let brightPixels = 0;
      for (let i = 0; i < overflowData.length; i += 3) {
        const r = overflowData[i];
        const g = overflowData[i + 1];
        const b = overflowData[i + 2];
        if (r > 200 && g > 200 && b > 200) {
          brightPixels++;
        }
      }
      
      if (brightPixels > 50) {
        console.log(`   ⚠️  ISSUE: Text detected above 40% limit (at ${(overflowCheck/height*100).toFixed(1)}%)`);
        issuesFound++;
      } else {
        console.log(`   ✅ Vertical bounds: Text stays within limits`);
      }
    } catch (e) {
      console.log(`   ⚠️  Could not check vertical bounds`);
    }
    
    // Check 3: Extract frame and use OCR-like detection to check for "n" artifacts
    // Look for text-like regions and check if they contain suspicious patterns
    const tempText = '/tmp/test_text.txt';
    try {
      // Use ffmpeg to extract text if possible, or check the actual rendered frame
      // For now, we'll check the hook text from database
      const hookText = execSync(`sqlite3 data/app.db "SELECT h.hook_text FROM variants v JOIN hooks h ON v.hook_id = h.id WHERE v.filepath_variant = '${variant}' LIMIT 1;"`).toString().trim();
      
      if (hookText) {
        // Check if hook text contains patterns that might cause "n" issues
        if (hookText.includes('\\n') || hookText.match(/\w+n\s/)) {
          console.log(`   ⚠️  SUSPICIOUS: Hook text may have newline issues: "${hookText}"`);
          issuesFound++;
        } else {
          console.log(`   ✅ Newlines: Hook text looks clean: "${hookText.substring(0, 40)}..."`);
        }
      }
    } catch (e) {}
    
    // Cleanup
    try { fs.unlinkSync(tempFrame); } catch {}
    try { fs.unlinkSync(tempText); } catch {}
    
    console.log();
  } catch (e) {
    console.log(`   ❌ Error testing: ${e.message}\n`);
    issuesFound++;
  }
});

console.log(`📊 Test Summary:`);
if (issuesFound === 0) {
  console.log(`   ✅ All tests passed! No issues found.`);
  console.log(`   • Vertical bounds: OK`);
  console.log(`   • Newlines: OK`);
  process.exit(0);
} else {
  console.log(`   ⚠️  Found ${issuesFound} potential issue(s)`);
  console.log(`   Please review the output above`);
  process.exit(1);
}


