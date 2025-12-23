import { db } from "../../db/db.js";
import { initSchema } from "../../db/schema.js";
import { llmJson } from "../../llm/client.js";
import { enqueueJob } from "../queue.js";
import { loadConfig } from "../../config/loader.js";
import { extractScreenshots, analyzeAudioFeatures, extractAudioSample } from "../../media/ffmpeg.js";
import path from "path";
import fs from "fs/promises";

initSchema();

export async function processGenHooksJob(clipId: number): Promise<void> {
  // Get clip with filepath
  const clip = db
    .prepare("SELECT id, filepath_clip FROM clips WHERE id = ?")
    .get(clipId) as { id: number; filepath_clip: string } | undefined;

  if (!clip) {
    throw new Error(`Clip not found: ${clipId}`);
  }

  // Verify clip file exists
  try {
    await fs.access(clip.filepath_clip);
  } catch {
    throw new Error(`Clip file not found: ${clip.filepath_clip}`);
  }

  const config = await loadConfig();
  const numHooks = config.hooks_per_clip || 4;

  // Extract screenshots from the video
  console.log(`[GEN_HOOKS] Extracting screenshots from clip_id=${clipId}...`);
  const screenshotsDir = path.join(process.cwd(), "working", "screenshots", `clip_${clipId}`);
  await fs.mkdir(screenshotsDir, { recursive: true });
  
  let screenshotPaths: string[] = [];
  try {
    screenshotPaths = await extractScreenshots(clip.filepath_clip, screenshotsDir, 3);
    console.log(`[GEN_HOOKS] Extracted ${screenshotPaths.length} screenshots`);
  } catch (error) {
    console.warn(`[GEN_HOOKS] Failed to extract screenshots, continuing without images:`, error);
  }

  // Extract and analyze audio
  let audioPath: string | undefined;
  let audioInfo = { hasAudio: false, likelySounds: [] as string[], audioDescription: "" };
  
  try {
    audioInfo = await analyzeAudioFeatures(clip.filepath_clip);
    if (audioInfo.hasAudio) {
      console.log(`[GEN_HOOKS] Video has audio track - extracting audio sample for analysis`);
      
      // Extract audio sample for LLM analysis
      const audioSamplePath = path.join(screenshotsDir, `audio_sample.wav`);
      try {
        await extractAudioSample(clip.filepath_clip, audioSamplePath, 5); // 5 second sample
        audioPath = audioSamplePath;
        console.log(`[GEN_HOOKS] Extracted audio sample for analysis`);
      } catch (error) {
        console.warn(`[GEN_HOOKS] Failed to extract audio sample:`, error);
      }
    }
  } catch (error) {
    console.warn(`[GEN_HOOKS] Audio analysis failed:`, error);
  }

  // Build prompt with audio context
  let audioContext = "";
  if (audioInfo.hasAudio && audioPath) {
    audioContext = `\n\nAUDIO ANALYSIS: An audio sample has been extracted from this video. Please analyze the actual sounds you can detect. Listen for:
- LICKING sounds: softer, smoother, wet/lapping noises
- CRUNCHING sounds: sharp, percussive, crackling, crunchy noises  
- CHEWING/MUNCHING sounds: rhythmic chewing, smacking sounds
- Other distinct sounds that help identify the action

The audio is the most reliable indicator - trust what you hear to determine if it's licking or crunching.`;
  }

  const prompt = `Look carefully at these screenshots${audioPath ? " and analyze the audio" : ""} from a video clip. Analyze EXACTLY what the cat is doing by combining BOTH visual and audio cues.${audioContext}

VISUAL ANALYSIS: Pay close attention to the cat's tongue, mouth position, expression, and what it's interacting with.
AUDIO ANALYSIS: Listen carefully to the actual sounds. Determine if you hear:
- LICKING sounds: softer, smoother, wet sounds, lapping noises
- CRUNCHING/CHEWING sounds: sharp, percussive, crunchy, crackling sounds
- MUNCHING sounds: rhythmic chewing, smacking
- Other sounds: describe what you actually hear

CRITICAL: Use BOTH visual AND audio to determine the action:
- If the cat is LICKING (tongue visible/extended, licking motion) → use "licking", "lick", "lapping"
- If the cat is CRUNCHING/CHEWING (chewing motion, solid food, jaw movement) → use "crunching", "crunch", "chewing", "munching"
- If the cat is doing something else → describe that accurately
- DO NOT guess or assume - only reference what you can actually see
- DO NOT use "crunch" if you see "licking" - be 100% accurate

Generate ${numHooks} UNIQUE, DIVERSE hook phrases (3-6 words each) using PROVEN VIRAL PATTERNS:

1. CONTRADICTIONS & CONTRAST (creates unresolved tension):
   - "Terrified? Absolutely. Ready? Not really. Worth it? 100%."
   - "I'm supposed to be working, but this cat..."
   - Use contrasting emotions or situations that create tension

2. THE SPECIFICITY EFFECT (hyper-specific details create credibility):
   - Generic: "If you ever get bloated after a meal..."
   - Specific: "If you've ever secretly unbuttoned your jeans at dinner..."
   - Be weirdly specific about the moment, the sound, the expression
   - Example: "When your cat makes that exact sound at 3am"

3. TIMEFRAME TENSION (unexpected timeframes create curiosity):
   - "3 years of back progress in 30 seconds"
   - "Three months ago I had 0 followers..."
   - Use unexpected timeframes or "wait for X moment" patterns
   - Example: "Wait 2 seconds for the sound"

4. POVs = ADVICE IN DISGUISE (scenarios that feel relatable):
   - "POV: you figured out how to not pay a fortune..."
   - "POV: You don't feel like cooking, but still want..."
   - Frame as relatable scenarios, not instructions
   - Example: "POV: You're trying to work but this sound exists"

5. GENUINE HUMAN MOMENTS (don't feel like hooks at all):
   - The best hooks read like someone just happened to articulate a moment perfectly
   - Sound like a real person sharing something, not a content creator
   - Example: "I didn't know I needed to hear this"

REQUIREMENTS FOR EACH HOOK:
- ACCURATELY reflect what the cat is doing (licking OR crunching) but DON'T always explicitly name it
- Use creative, indirect ways to reference the action - focus on the moment, the sound, the feeling
- Use ONE of the viral patterns above (mix them across the ${numHooks} hooks)
- VARY SIGNIFICANTLY from each other - each hook should feel different and unique
- Sound natural and conversational (like a real person would say)
- Create curiosity gaps that make people want to watch
- NO repetitive phrases - each hook must be distinct and fresh
- NO generic phrases - be specific to what's in the video
- NO emojis, NO health claims, NO hashtags
- NO "guru" vibes - should feel like genuine human moments
- AVOID overusing action words - only mention "licking/crunching" if it adds to the hook naturally

Examples for LICKING (if that's what you see) - notice how most DON'T say "licking":
- "POV: You're trying to focus but that sound exists" (POV pattern, indirect)
- "Wait 2 seconds for it" (Timeframe tension, mysterious)
- "I didn't know I needed to hear this" (Genuine moment, no action named)
- "Trying to work? This cat says otherwise" (Contradiction, no action named)
- "That sound at 3am hits different" (Specificity, indirect)
- "The way she looks up mid-sound" (Visual moment, indirect)

Examples for CRUNCHING (if that's what you see) - notice how most DON'T say "crunching":
- "POV: You found the most satisfying sound on the internet" (POV pattern, indirect)
- "3 seconds that changed everything" (Timeframe tension, mysterious)
- "If you've ever needed this at 2am" (Specificity, indirect)
- "I'm supposed to be productive but this sound..." (Contradiction, indirect)
- "That sound is everything" (Simple, indirect)
- "Wait for the moment" (Timeframe, indirect)

CRITICAL REQUIREMENTS:
1. Be 100% accurate in understanding the action (licking vs crunching) but DON'T always name it explicitly
2. Use creative, indirect references - focus on the sound, the moment, the feeling, the expression
3. Use the viral patterns above - mix contradiction, specificity, timeframe, POV, and genuine moments
4. Make each hook UNIQUE and DIFFERENT from the others
5. Vary the structure, style, and approach of each hook
6. Focus on what makes THIS specific moment unique
7. Sound like a real person, not a content creator
8. Only mention "licking" or "crunching" if it naturally adds to the hook - most hooks should reference it indirectly

Return JSON with a single field "hooks" containing EXACTLY ${numHooks} unique, diverse, top-quality hook strings that accurately match what you see in the video and use proven viral patterns. Format: {"hooks": ["hook1", "hook2", "hook3", "hook4"]}`;

  console.log(`[GEN_HOOKS] Generating hooks for clip_id=${clipId} based on video AND audio content...`);

  const response = await llmJson(
    prompt, 
    screenshotPaths.length > 0 ? screenshotPaths : undefined,
    audioPath
  );
  let hooks = response.hooks || [];

  if (!Array.isArray(hooks) || hooks.length === 0) {
    throw new Error("LLM did not return a valid hooks array");
  }

  // Limit to maximum 4 hooks (enforce config limit)
  hooks = hooks.slice(0, numHooks);

  const insertStmt = db.prepare(
    "INSERT INTO hooks (clip_id, hook_text, hook_style, generation, source) VALUES (?, ?, 'auto', 1, 'auto')"
  );

  let insertedCount = 0;
  for (const hook of hooks) {
    if (typeof hook === "string" && hook.trim().length > 0) {
      try {
        insertStmt.run(clipId, hook.trim());
        insertedCount++;
      } catch (error: any) {
        // Skip if UNIQUE constraint violation (duplicate hook)
        if (!error.message || !error.message.includes("UNIQUE")) {
          throw error;
        }
      }
    }
  }

  console.log(`[GEN_HOOKS] Inserted ${insertedCount} hooks for clip_id=${clipId}`);

  // Enqueue render job for this clip
  enqueueJob("render", "clip", clipId);
}

