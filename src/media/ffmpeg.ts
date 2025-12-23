import { execa } from "execa";

export async function getVideoDimensions(filepath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execa("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    filepath,
  ]);

  const [width, height] = stdout.trim().split("x").map(Number);
  return { width, height };
}

export async function sliceVideo(
  inputPath: string,
  outputPath: string,
  startSec: number,
  durationSec: number
): Promise<void> {
  await execa("ffmpeg", [
    "-i",
    inputPath,
    "-ss",
    startSec.toString(),
    "-t",
    durationSec.toString(),
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    outputPath,
  ]);
}

export interface TextOverlayOptions {
  fontSize?: number;
  fontColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  position?: "top" | "center" | "bottom";
}

// Helper function to truncate text to max words (preserves whole words)
function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ") + "…";
}

// Helper function to wrap text into multiple lines based on video width
function wrapText(text: string, maxCharsPerLine: number): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    
    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      // If a single word is longer than max, just add it anyway
      currentLine = word.length > maxCharsPerLine ? word.substring(0, maxCharsPerLine) : word;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines.join('\n'); // Use actual newline character (real \n, not escaped)
}

export async function extractScreenshots(
  inputPath: string,
  outputDir: string,
  count: number = 3
): Promise<string[]> {
  // Get video duration
  const { stdout: durationOutput } = await execa("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const duration = parseFloat(durationOutput.trim());
  
  // Extract evenly spaced screenshots
  const screenshots: string[] = [];
  const interval = duration / (count + 1); // Avoid first and last frame
  
  for (let i = 1; i <= count; i++) {
    const timestamp = interval * i;
    const screenshotPath = `${outputDir}/frame_${i}_${timestamp.toFixed(2)}s.jpg`;
    
    await execa("ffmpeg", [
      "-ss", timestamp.toFixed(3),
      "-i", inputPath,
      "-vf", "scale=1080:-1", // Resize for faster processing
      "-frames:v", "1",
      "-q:v", "2", // High quality
      "-y",
      screenshotPath,
    ]);
    
    screenshots.push(screenshotPath);
  }
  
  return screenshots;
}

export async function analyzeAudioFeatures(inputPath: string): Promise<{
  hasAudio: boolean;
  likelySounds: string[];
  audioDescription: string;
}> {
  try {
    // Check if audio stream exists
    const { stdout: audioCheck } = await execa("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_type",
      "-of", "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);

    const hasAudio = audioCheck.trim().length > 0;

    if (!hasAudio) {
      return { hasAudio: false, likelySounds: [], audioDescription: "No audio track" };
    }

    // Extract audio to analyze characteristics
    const tempAudioPath = inputPath.replace(/\.(mp4|mov|avi)$/i, "_temp_audio.wav");
    
    try {
      // Extract audio as WAV for analysis (short segment)
      await execa("ffmpeg", [
        "-i", inputPath,
        "-t", "5", // Analyze first 5 seconds
        "-vn", // No video
        "-acodec", "pcm_s16le", // Uncompressed audio
        "-ar", "16000", // Sample rate
        "-ac", "1", // Mono
        "-y",
        tempAudioPath,
      ]);

      // Analyze audio with ffprobe to get volume/amplitude info
      const { stdout: volumeInfo } = await execa("ffprobe", [
        "-v", "error",
        "-f", "lavfi",
        "-i", `amovie=${tempAudioPath},astats=metadata=1:reset=1`,
        "-show_entries", "frame=pkt_pts_time:frame_tags=lavfi.astats.Overall.RMS_level",
        "-of", "json",
      ]).catch(() => ({ stdout: "{}" }));

      // Analyze audio characteristics using ffmpeg filters
      // Get peak amplitude and RMS levels to understand audio characteristics
      const { stdout: stats } = await execa("ffmpeg", [
        "-i", tempAudioPath,
        "-af", "astats=metadata=1:reset=1",
        "-f", "null",
        "-",
      ], { reject: false }).catch(() => ({ stdout: "" }));

      // Clean up temp file
      try {
        await execa("rm", [tempAudioPath]).catch(() => {});
      } catch {}

      // Analyze the audio stats to infer sound type
      // High frequency content = likely crunching/chewing
      // Lower frequency, smoother = likely licking
      // We'll use the audio description for the LLM to analyze
      const audioDescription = `Audio track detected. Audio characteristics: ${stats.includes("RMS") ? "Variable amplitude detected" : "Audio present"}. Use audio analysis to determine if sounds indicate licking (softer, smoother) or crunching (sharp, percussive).`;

      return { 
        hasAudio: true, 
        likelySounds: [], // Will be determined by LLM with audio context
        audioDescription 
      };
    } catch (error) {
      // Audio extraction failed, but audio exists
      return { 
        hasAudio: true, 
        likelySounds: [], 
        audioDescription: "Audio track present but could not analyze characteristics"
      };
    }
  } catch (error) {
    return { hasAudio: false, likelySounds: [], audioDescription: "No audio track" };
  }
}

export async function extractAudioSample(
  inputPath: string,
  outputPath: string,
  durationSeconds: number = 5
): Promise<void> {
  await execa("ffmpeg", [
    "-i", inputPath,
    "-t", durationSeconds.toString(),
    "-vn", // No video
    "-acodec", "copy", // Copy audio codec
    "-y",
    outputPath,
  ]);
}

export async function renderTextOverlay(
  inputPath: string,
  outputPath: string,
  text: string,
  options: TextOverlayOptions = {}
): Promise<void> {
  const {
    fontSize, // If not provided, will calculate based on video dimensions
    fontColor = "white",
    strokeColor = "black",
    strokeWidth = 5,
    position = "top", // Default to top (HOOK zone) for hooks
  } = options;

  // Get video dimensions first (needed for font size and text wrapping)
  let videoWidth = 1080; // Default for Reels/Shorts
  let videoHeight = 1920;
  
  try {
    const dimensions = await getVideoDimensions(inputPath);
    videoWidth = dimensions.width;
    videoHeight = dimensions.height;
  } catch (error) {
    console.warn("[FFMPEG] Could not determine video dimensions, using defaults");
  }

  // Calculate optimal font size for Reels/Shorts if not provided
  // Scale with both height AND width for better consistency
  // Standard Reels format: 1080x1920, optimal font: ~72px for mobile readability
  let finalFontSize = fontSize;
  if (!finalFontSize) {
    const standardHeight = 1920;
    const standardWidth = 1080;
    const standardFontSize = 72;
    // Scale by both dimensions, use the smaller scaling factor (to ensure it fits)
    const heightScale = videoHeight / standardHeight;
    const widthScale = videoWidth / standardWidth;
    const scaleFactor = Math.min(heightScale, widthScale);
    finalFontSize = Math.max(32, Math.round(standardFontSize * scaleFactor));
  }

  // Stroke width scales with font size for better readability (10% of font size)
  // Calculate this early as it affects character width calculations
  let finalStrokeWidth = Math.max(3, Math.round(finalFontSize * 0.10));

  // Calculate max characters per line based on video width and font size
  // Account for stroke width in character calculations (more accurate)
  const charWidthPixels = finalFontSize * 0.55 + finalStrokeWidth * 0.6;
  const maxTextWidth = videoWidth * 0.62; // 62% of video width (prevents edge clipping)
  let maxCharsPerLine = Math.max(10, Math.floor(maxTextWidth / charWidthPixels)); // Minimum 10 chars
  
  // FORCE wrapping - be more aggressive with shorter lines for mobile readability
  // Reels/Shorts work best with shorter lines (15-20 chars max)
  maxCharsPerLine = Math.min(maxCharsPerLine, 20); // Cap at 20 chars for mobile
  
  // Truncate to max 6 words BEFORE wrapping (prevents ugly broken words)
  text = truncateWords(text, 6);
  
  // Wrap text into multiple lines, then enforce max 2 lines
  // Use the calculated maxCharsPerLine, but ensure it forces wrapping
  let wrappedText = wrapText(text, maxCharsPerLine);
  
  // DEBUG: Log wrapping info
  const initialLines = wrappedText.split('\n');
  console.log(`[FFMPEG] Wrapping "${text}" (${text.length} chars) into max ${maxCharsPerLine} chars/line = ${initialLines.length} lines`);
  console.log(`[FFMPEG] Wrapped result: "${wrappedText.replace(/\n/g, ' [NL] ')}"`);
  
  // FORCE wrapping if text is long and not wrapped
  if (initialLines.length === 1 && text.length > 20) {
    console.warn(`[FFMPEG] Text is too long for one line (${text.length} chars), forcing wrap`);
    // Find a good break point (space after ~15-18 chars)
    const words = text.split(' ');
    if (words.length >= 2) {
      const midPoint = Math.ceil(words.length / 2);
      wrappedText = words.slice(0, midPoint).join(' ') + '\n' + words.slice(midPoint).join(' ');
      console.log(`[FFMPEG] Force-wrapped at word ${midPoint}: "${wrappedText.replace(/\n/g, ' [NL] ')}"`);
    }
  }
  
  // Enforce max 2 lines for hooks (keeps them punchy, prevents covering subject)
  let lines = wrappedText.split('\n');
  if (lines.length > 2) {
    // Too many lines - reduce font size and re-wrap
    let attemptCount = 0;
    let currentFontSize = finalFontSize;
    let currentStrokeWidth = finalStrokeWidth;
    while (lines.length > 2 && attemptCount < 3) {
      currentFontSize = Math.max(32, Math.round(currentFontSize * 0.9)); // Reduce by 10%
      currentStrokeWidth = Math.max(3, Math.round(currentFontSize * 0.10)); // Recalculate stroke
      const newCharWidth = currentFontSize * 0.55 + currentStrokeWidth * 0.6;
      const newMaxChars = Math.floor(maxTextWidth / newCharWidth);
      wrappedText = wrapText(text, Math.max(10, newMaxChars));
      lines = wrappedText.split('\n'); // Update lines after re-wrapping
      if (lines.length <= 2) {
        finalFontSize = currentFontSize;
        finalStrokeWidth = currentStrokeWidth;
        break;
      }
      attemptCount++;
    }
    // If still > 2 lines, just truncate to first 2 lines
    if (lines.length > 2) {
      wrappedText = lines.slice(0, 2).join('\n');
    }
  }
  
  // Strip problematic punctuation that causes rendering issues
  // IMPORTANT: Do NOT strip backslashes - we need real newlines in the file
  // Only strip characters that break FFmpeg rendering, preserve actual newline chars
  wrappedText = wrappedText.replace(/[%\[\]]/g, '');
  
  // CRITICAL: Ensure we have real newline characters (not escaped strings)
  // Replace any literal "\n" strings with actual newlines BEFORE writing
  // Also handle any double-escaped newlines
  wrappedText = wrappedText.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');
  
  // Verify we have actual newline characters
  if (!wrappedText.includes('\n') && wrappedText.length > 15) {
    // Force wrap if no newlines exist and text is long
    console.warn(`[FFMPEG] No newlines detected, forcing wrap for text: "${wrappedText}"`);
    const midPoint = Math.ceil(wrappedText.length / 2);
    const spaceIndex = wrappedText.indexOf(' ', midPoint);
    if (spaceIndex > 0) {
      wrappedText = wrappedText.substring(0, spaceIndex) + '\n' + wrappedText.substring(spaceIndex + 1);
    }
  }

  // Calculate text height to prevent vertical overflow
  // Use wrappedText directly (already has newlines)
  let finalTextForHeight = wrappedText; // Use the already-wrapped text
  // Count actual newlines (should be real newlines from wrapText)
  const fileLineCount = (finalTextForHeight.match(/\n/g) || []).length + 1;
  let actualLineCount = Math.max(1, Math.min(2, fileLineCount));
  const lineSpacing = 10;
  // More accurate: account for line height (font size + some padding) per line
  let lineHeight = finalFontSize * 1.2; // 1.2x for line height including spacing
  let estimatedTextHeight = (lineHeight * actualLineCount) + (lineSpacing * Math.max(0, actualLineCount - 1));
  
  console.log(`[FFMPEG] Text height calculation: ${actualLineCount} lines × ${lineHeight.toFixed(0)}px + spacing = ${estimatedTextHeight.toFixed(0)}px`);
  
  // Vertical bounds checking - ensure text doesn't exceed safe zones
  let maxY: number;
  let minY: number;
  
  if (position === "top") {
    // TOP position: Text must not extend below 40% of video height
    // This keeps it in the safe hook zone and avoids covering subject
    maxY = videoHeight * 0.40;
    minY = videoHeight * 0.10; // Minimum safe distance from top UI
  } else if (position === "bottom") {
    // BOTTOM position: Text must not extend above 60% of video height
    // Keeps it in subtitle zone
    minY = videoHeight * 0.60;
    maxY = videoHeight * 0.95; // Leave some margin from bottom
  } else {
    // CENTER position: Keep in middle third (33-67%)
    minY = videoHeight * 0.33;
    maxY = videoHeight * 0.67;
  }
  
  // If text would exceed bounds, reduce font size BEFORE writing final filter
  if (position === "top") {
    const startY = videoHeight * 0.17; // Target start position
    let endY = startY + estimatedTextHeight;
    console.log(`[FFMPEG] Vertical check: start=${startY.toFixed(0)}px, end=${endY.toFixed(0)}px, max=${maxY.toFixed(0)}px`);
    
    // Keep reducing font until it fits
    let adjustedFontSize = finalFontSize;
    let adjustedStrokeWidth = finalStrokeWidth;
    let iterations = 0;
    
    while (endY > maxY && iterations < 10) {
      const maxHeight = maxY - startY;
      const availableHeightPerLine = (maxHeight - (lineSpacing * (actualLineCount - 1))) / actualLineCount;
      adjustedFontSize = Math.floor(availableHeightPerLine / 1.2);
      adjustedStrokeWidth = Math.max(3, Math.round(adjustedFontSize * 0.10));
      
      if (adjustedFontSize < 28) {
        // Can't fit even with min font - force single line
        console.warn(`[FFMPEG] Cannot fit with min font, forcing single line`);
        finalTextForHeight = finalTextForHeight.replace(/\n/g, ' ');
        actualLineCount = 1;
        adjustedFontSize = Math.max(28, Math.floor((maxHeight - lineSpacing) / 1.2));
        lineHeight = adjustedFontSize * 1.2;
        estimatedTextHeight = lineHeight + lineSpacing;
        break;
      }
      
      // Recalculate with new font
      const newLineHeight = adjustedFontSize * 1.2;
      const newEstimatedHeight = (newLineHeight * actualLineCount) + (lineSpacing * Math.max(0, actualLineCount - 1));
      endY = startY + newEstimatedHeight;
      
      if (endY <= maxY) {
        console.warn(`[FFMPEG] Reduced font from ${finalFontSize}px to ${adjustedFontSize}px to fit bounds`);
        finalFontSize = adjustedFontSize;
        finalStrokeWidth = adjustedStrokeWidth;
        break;
      }
      
      iterations++;
    }
    
    if (endY > maxY) {
      console.error(`[FFMPEG] ERROR: Text still exceeds bounds after font reduction!`);
    }
  } else if (position === "bottom") {
    const endY = videoHeight * 0.78; // 22% from bottom = 78% from top
    const startY = endY - estimatedTextHeight;
    if (startY < minY) {
      const maxHeight = endY - minY;
      const availableHeightPerLine = (maxHeight - (lineSpacing * (actualLineCount - 1))) / actualLineCount;
      const maxFontSize = Math.floor(availableHeightPerLine / 1.2); // Divide by line height multiplier
      if (maxFontSize < finalFontSize && maxFontSize >= 28) {
        console.warn(`[FFMPEG] Text would exceed vertical bounds, reducing font from ${finalFontSize}px to ${maxFontSize}px`);
        finalFontSize = maxFontSize;
        finalStrokeWidth = Math.max(3, Math.round(finalFontSize * 0.10));
      }
    }
  }

  // Position calculations using safe-title margins (more robust than rule-of-thirds)
  // Accounts for platform UI differences (TikTok vs Instagram)
  // - TOP (HOOK zone): 17% from top (safe from UI overlays)
  // - CENTER (Subject zone): Middle - keep clear for subject
  // - BOTTOM (Subtitles zone): 22% from bottom (safe from captions/UI)
  let yPos: string;
  
  if (position === "top") {
    // HOOK zone: Safe margin from top (17% - automatically detected optimal position)
    // Auto-detection found text appearing at 16.7%, adjusted to 17% for safety margin
    // Vertical bounds check ensures text doesn't exceed 40% (doesn't cover subject)
    yPos = "h*0.17";
  } else if (position === "bottom") {
    // Subtitles zone: Larger margin from bottom (22% - avoids IG captions and platform UI)
    yPos = "h-text_h-h*0.22";
  } else {
    // Subject zone: Center position (middle third)
    // Usually avoid text here to not cover subject
    yPos = "(h-text_h)/2";
  }

  // ALTERNATIVE APPROACH: Use multiple drawtext filters (one per line) instead of textfile
  // CRITICAL: Always split text into separate lines and use separate drawtext filters
  // This completely avoids newline escaping issues - each line is independent
  
  // Start with wrappedText - check if it has newlines (actual \n characters, not string "\n")
  let textLines = wrappedText.split('\n').filter(line => line.trim().length > 0);
  
  // Verify we're splitting on REAL newlines, not escaped strings
  const textHasRealNewlines = wrappedText.includes('\n');
  console.log(`[FFMPEG] wrappedText: "${wrappedText.replace(/\n/g, ' [NL] ')}"`);
  console.log(`[FFMPEG] Has real newlines: ${textHasRealNewlines}, split into ${textLines.length} lines`);
  
  // If only 1 line and text is long enough, ALWAYS force split into 2 lines
  // This ensures we use multiple filters and avoid any newline rendering issues
  if (textLines.length === 1 && wrappedText.length > 12) {
    console.warn(`[FFMPEG] Single line detected (${wrappedText.length} chars), forcing split into 2 lines`);
    const words = wrappedText.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      // Split at midpoint
      const midPoint = Math.ceil(words.length / 2);
      const line1 = words.slice(0, midPoint).join(' ');
      const line2 = words.slice(midPoint).join(' ');
      textLines = [line1, line2];
      console.log(`[FFMPEG] Force-split: Line 1="${line1}" (${line1.length} chars), Line 2="${line2}" (${line2.length} chars)`);
    } else {
      console.error(`[FFMPEG] Cannot split - only ${words.length} word(s) in "${wrappedText}"`);
    }
  }
  
  // Enforce max 2 lines
  if (textLines.length > 2) {
    console.warn(`[FFMPEG] Text has ${textLines.length} lines, truncating to 2`);
    textLines = textLines.slice(0, 2);
  }
  
  // Final verification - textLines should now have 1 or 2 elements
  console.log(`[FFMPEG] Final: ${textLines.length} line(s) ready for separate filters:`, textLines.map((l, i) => `[${i}]"${l}"`).join(' | '));
  const lineSpacingPixels = 10;
  const lineHeightPixels = Math.round(finalFontSize * 1.2);
  
  // Use textfile= parameter for each line to COMPLETELY avoid escaping issues
  // This is the safest approach - write each line to a temp file and reference it
  // No escaping needed at all!
  const fs = await import("fs/promises");
  const os = await import("os");
  const pathModule = await import("path");
  const tempTextFiles: string[] = [];
  const drawtextFilters: string[] = [];
  
  // Cleanup function to remove temp files
  const cleanup = async () => {
    for (const file of tempTextFiles) {
      try {
        await fs.unlink(file).catch(() => {}); // Ignore errors
      } catch {}
    }
  };
  
  try {
    // Create a temp text file for each line (avoids ALL escaping issues)
    for (let i = 0; i < Math.min(textLines.length, 2); i++) {
      const line = textLines[i];
      
      // Clean the line - remove control characters only
      const cleanLine = line.replace(/[\x00-\x1F\x7F]/g, '').trim();
      
      // Create temp file for this line
      const tempFile = pathModule.join(os.tmpdir(), `hook_line_${i}_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
      await fs.writeFile(tempFile, cleanLine, 'utf8');
      tempTextFiles.push(tempFile);
      
      // Calculate Y position for this line
      let lineY: string;
      if (i === 0) {
        lineY = yPos;
      } else {
        if (position === "top") {
          lineY = `h*0.17+${lineHeightPixels}*${i}+${lineSpacingPixels}*${i}`;
        } else {
          lineY = `${yPos}+text_h*${i}+${lineSpacingPixels}*${i}`;
        }
      }
      
      // Use textfile= parameter - no escaping needed!
      // Escape the file path for FFmpeg (only need to escape colons and backslashes in path)
      const escapedPath = tempFile.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
      drawtextFilters.push(`drawtext=textfile='${escapedPath}':fontsize=${finalFontSize}:fontcolor=${fontColor}:x=(w-text_w)/2:y=${lineY}:borderw=${finalStrokeWidth}:bordercolor=${strokeColor}:fix_bounds=1`);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
  
  // Chain multiple filters with commas
  const drawtextFilter = drawtextFilters.join(',');
  
  console.log(`[FFMPEG] Using ${textLines.length} line(s) with textfile= (no escaping needed!)`);
  console.log(`[FFMPEG] Lines: ${textLines.map((l, i) => `[${i}]"${l}"`).join(' | ')}`);
  console.log(`[FFMPEG] Temp files: ${tempTextFiles.map(f => pathModule.basename(f)).join(', ')}`);
  console.log(`[FFMPEG] Filter preview: ${drawtextFilter.substring(0, 200)}...`);
  console.log(`[FFMPEG] Using font size: ${finalFontSize}px, estimated height: ${estimatedTextHeight.toFixed(0)}px`);

  try {
    await execa("ffmpeg", [
      "-i",
      inputPath,
      "-vf",
      drawtextFilter,
      "-c:a",
      "copy",
      "-y", // Overwrite output file
      outputPath,
    ]);
    
    // Cleanup temp files after successful render
    await cleanup();
  } catch (error) {
    await cleanup();
    throw error;
  }
}

