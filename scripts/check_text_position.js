const { execSync } = require('child_process');
const fs = require('fs');

function detectTextPosition(videoPath) {
  try {
    const height = parseInt(execSync(`ffprobe -v error -show_entries stream=height -of csv=s=x:p=0 "${videoPath}"`).toString().trim());
    const width = parseInt(execSync(`ffprobe -v error -show_entries stream=width -of csv=s=x:p=0 "${videoPath}"`).toString().trim());
    
    // Extract frame and analyze
    const tempFrame = '/tmp/frame_analysis.png';
    execSync(`ffmpeg -i "${videoPath}" -ss 1 -frames:v 1 -vf "format=gray" -y "${tempFrame}" 2>/dev/null`);
    
    const candidates = [];
    
    // Search in top 40% of frame
    for (let y = 50; y < height * 0.40; y += 3) {
      try {
        const cmd = `ffmpeg -i "${tempFrame}" -vf "crop=${width}:1:0:${y},format=gray" -frames:v 1 -f rawvideo -pix_fmt gray - 2>/dev/null`;
        const lineData = execSync(cmd);
        
        let brightCount = 0;
        let darkCount = 0;
        let transitions = 0;
        let prevBright = false;
        
        for (let i = 0; i < lineData.length; i++) {
          const pixel = lineData[i];
          const isBright = pixel > 200;
          const isDark = pixel < 50;
          
          if (isBright) {
            brightCount++;
            if (!prevBright) transitions++;
            prevBright = true;
          } else if (isDark) {
            darkCount++;
            if (prevBright) transitions++;
            prevBright = false;
          }
        }
        
        // Text with stroke: bright pixels + dark pixels + transitions
        const textScore = (brightCount / width) * 0.4 + 
                         (darkCount / width) * 0.3 + 
                         (transitions / width) * 0.3;
        
        if (textScore > 0.20 && brightCount > width * 0.05) {
          candidates.push({ y, percent: (y / height) * 100, score: textScore });
        }
      } catch (e) {}
    }
    
    try { fs.unlinkSync(tempFrame); } catch {}
    
    if (candidates.length > 5) {
      candidates.sort((a, b) => b.score - a.score);
      const topCandidate = candidates[0];
      const nearby = candidates.filter(c => Math.abs(c.y - topCandidate.y) <= 20);
      const clusterY = Math.round(nearby.reduce((sum, c) => sum + c.y, 0) / nearby.length);
      
      return {
        found: true,
        y: clusterY,
        percent: (clusterY / height) * 100,
        confidence: topCandidate.score
      };
    }
    
    return { found: false };
  } catch (e) {
    return { found: false, error: e.message };
  }
}

// Main
const variants = execSync('sqlite3 data/app.db "SELECT filepath_variant FROM variants ORDER BY id DESC LIMIT 3;"').toString().trim().split('\n').filter(v => v && fs.existsSync(v));

console.log(`📹 Analyzing ${variants.length} video variants...\n`);

const results = [];
variants.forEach((variant, idx) => {
  const filename = variant.split('/').pop();
  console.log(`📸 ${filename}`);
  
  const result = detectTextPosition(variant);
  
  if (result.found) {
    console.log(`   ✅ Text at: ${result.y}px (${result.percent.toFixed(1)}%)`);
    results.push(result);
  } else {
    console.log(`   ⚠️  Could not detect`);
  }
  console.log();
});

if (results.length > 0) {
  const avgPercent = results.reduce((sum, r) => sum + r.percent, 0) / results.length;
  const currentPercent = 17.0; // Current setting in ffmpeg.ts
  const diff = Math.abs(avgPercent - currentPercent);
  
  console.log(`📊 Summary: Average detected position = ${avgPercent.toFixed(1)}%`);
  console.log(`   Current setting: ${currentPercent}%`);
  console.log(`   Difference: ${diff.toFixed(1)}%\n`);
  
  if (diff > 2) {
    console.log(`🔧 ADJUST NEEDED: Change from ${currentPercent}% to ${avgPercent.toFixed(1)}%`);
    process.exit(1); // Exit with error to signal adjustment needed
  } else {
    console.log(`✅ Position correct!`);
    process.exit(0);
  }
} else {
  console.log(`⚠️  Could not detect text`);
  process.exit(2);
}

