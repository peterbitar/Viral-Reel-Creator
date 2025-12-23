import "dotenv/config";
import { execa } from "execa";

const provider = process.env.LLM_PROVIDER || "openai";
const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";

if (!apiKey) {
  console.warn("[LLM] No API key found. Set LLM_API_KEY or OPENAI_API_KEY in .env");
}

export async function llmJson(prompt: string, imagePaths?: string[], audioPath?: string): Promise<any> {
  if (!apiKey) {
    throw new Error("LLM API key not configured");
  }

  // For now, use OpenAI API via curl/execa
  // In production, you might want to use the official SDK
  if (provider === "openai" || !provider) {
    const fs = await import("fs/promises");
    
    // Build message content
    const messageContent: any[] = [{ type: "text", text: prompt }];
    
    // Add images if provided (convert to base64)
    if (imagePaths && imagePaths.length > 0) {
      for (const imagePath of imagePaths) {
        try {
          const imageBuffer = await fs.readFile(imagePath);
          const base64Image = imageBuffer.toString("base64");
          
          // Determine image type from extension
          const ext = imagePath.split(".").pop()?.toLowerCase();
          const mimeType = ext === "png" ? "image/png" : "image/jpeg";
          
          messageContent.push({
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
            },
          });
        } catch (error) {
          console.warn(`[LLM] Failed to read image ${imagePath}:`, error);
        }
      }
    }

    // Add audio if provided (convert to base64)
    // Note: GPT-4o supports audio input via the audio API, but for chat completions we need to transcribe first
    // For now, we'll include audio context in the prompt instead of sending raw audio
    // In the future, could use Whisper API to transcribe first
    if (audioPath) {
      // Include audio context in prompt rather than sending raw audio
      // GPT-4o chat completions doesn't support raw audio input directly
      // We extract the audio and analyze it separately, then include findings in prompt
      try {
        const audioExists = await fs.access(audioPath).then(() => true).catch(() => false);
        if (audioExists) {
          // Note: Audio file exists, we'll mention it in the prompt
          // The actual audio analysis happens via the prompt asking the model to analyze
          // For full audio analysis, would need to use Whisper API or audio transcription first
        }
      } catch (error) {
        console.warn(`[LLM] Audio file check failed:`, error);
      }
    }

    const response = await execa("curl", [
      "-s",
      "https://api.openai.com/v1/chat/completions",
      "-H",
      "Content-Type: application/json",
      "-H",
      `Authorization: Bearer ${apiKey}`,
      "-d",
      JSON.stringify({
        model: "gpt-4o", // Use vision + audio capable model
        messages: [
          {
            role: "user",
            content: messageContent,
          },
        ],
        response_format: { type: "json_object" },
      }),
    ]);

    const data = JSON.parse(response.stdout);
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`LLM API error: ${response.stdout}`);
    }

    return JSON.parse(content);
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}

