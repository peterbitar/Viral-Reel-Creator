import { execa } from "execa";

export async function getDurationSec(filepath: string): Promise<number> {
  const { stdout } = await execa("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filepath,
  ]);

  const duration = parseFloat(stdout.trim());
  if (isNaN(duration)) {
    throw new Error(`Failed to parse duration from ffprobe output: ${stdout}`);
  }

  return duration;
}


