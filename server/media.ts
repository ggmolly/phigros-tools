import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

// what ffmpeg reads each type as. naming it stops ffmpeg from guessing a playlist that opens other files
const FORMATS: Record<string, string> = {
  "video/mp4": "mov",
  "video/quicktime": "mov",
  "video/webm": "matroska",
  "image/gif": "gif",
  "image/png": "png_pipe",
  "image/jpeg": "jpeg_pipe",
  "image/webp": "webp_pipe",
};

/**
 * A poster of an image or a video in `dir`, and a short muted clip of a video or a GIF, at most `width` wide: their
 * file names and the poster's size. Nothing for a type ffmpeg isn't given here, or without ffmpeg.
 */
export async function shown(dir: string, data: Uint8Array, type: string, width: number) {
  const format = FORMATS[type];
  if (!format || !Bun.which("ffmpeg")) return undefined;
  // named after what it holds: a file that changed gets new names, which nothing has cached
  const name = createHash("sha256").update(data).digest("hex").slice(0, 12);
  const source = `${dir}/${name}.source`;
  const poster = `${dir}/${name}.jpg`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(source, data);
  // given a file, never a url, and only allowed to read files
  const ffmpeg = async (...output: string[]) => {
    const run = Bun.spawn(
      [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-protocol_whitelist",
        "file",
        "-f",
        format,
        "-i",
        source,
        ...output,
      ],
      { stderr: "inherit" },
    );
    if ((await run.exited) !== 0) throw new Error(`ffmpeg couldn't read ${name} (${type})`);
  };
  // h.264 wants even sizes
  const scale = `scale='trunc(min(${width},iw)/2)*2':-2`;
  const moving = type.startsWith("video/") || type === "image/gif";
  if (moving)
    await ffmpeg(
      "-an",
      "-t",
      "12",
      "-vf",
      `${scale},fps=30`,
      "-c:v",
      "libx264",
      "-profile:v",
      "baseline",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "30",
      "-movflags",
      "+faststart",
      `${dir}/${name}.mp4`,
    );
  await ffmpeg("-frames:v", "1", "-vf", scale, poster);
  rmSync(source);
  const probe = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      poster,
    ],
    { stderr: "inherit" },
  );
  const [wide, high] = (await new Response(probe.stdout).text()).trim().split(",").map(Number);
  return {
    poster: `${name}.jpg`,
    clip: moving ? `${name}.mp4` : undefined,
    width: wide!,
    height: high!,
  };
}
