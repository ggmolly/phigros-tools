import { defineHandler, getQuery, HTTPError } from "nitro/h3";
import satori from "satori";
import sharp from "sharp";
import catalog from "../../../../../src/catalog.json";
import stats from "../../../../../src/chart-stats.json";

const LEVELS = ["EZ", "HD", "IN", "AT"];
const W = 1200;
const H = 630;
const TAN = 0.25;
const songs = new Map(
  (catalog.songs as { id: string; constants: (number | null)[] }[]).map((song) => [song.id, song]),
);
const lengths = stats.songs as Record<string, ({ lengthSec: number } | null)[]>;

let font: Promise<ArrayBuffer> | undefined;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const slanted = (w: number, h: number) =>
  `polygon(${h * TAN}px 0, ${w}px 0, ${w - h * TAN}px ${h}px, 0 ${h}px)`;
// satori takes React-element-shaped objects; plain ones keep this file free of a JSX setup
const box = (style: Record<string, unknown>, children?: unknown) => ({
  type: "div",
  props: { style: { display: "flex", position: "absolute", ...style }, children },
});

export default defineHandler(async (event) => {
  const { id, file } = event.context.params as { id: string; file: string };
  const song = songs.get(decodeURIComponent(id));
  const level = /^(EZ|HD|IN|AT)\.jpg$/.exec(file)?.[1];
  const index = level ? LEVELS.indexOf(level) : -1;
  if (!song || index < 0 || song.constants[index] == null) throw new HTTPError({ status: 404 });

  const origin = new URL(event.req.url).origin;
  const base = await fetch(`${origin}/covers/${encodeURIComponent(song.id)}.${level}.og.jpg`);
  if (!base.ok) throw new HTTPError({ status: 404 });
  font ??= fetch(`${origin}/fonts/card/Saira-500.ttf`).then((res) => res.arrayBuffer());

  const length = lengths[song.id]?.[index]?.lengthSec ?? 0;
  const requested = Math.floor(Number(getQuery(event).t));
  const t = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), Math.floor(length)) : 0;
  const p = length > 0 ? t / length : 0;
  // track from x 128 to 1072 in the band under the stats strip, thumb slides along it
  const x0 = 128;
  const track = 944;
  const thumb = 30;
  const overlay = await satori(
    box({ left: 0, top: 0, width: W, height: H, fontFamily: "Saira", color: "#fff" }, [
      box({ left: 56, top: 582, width: 64, fontSize: 24 }, mmss(t)),
      box({
        left: x0,
        top: 596,
        width: track,
        height: 14,
        background: "rgba(0,0,0,0.55)",
        clipPath: slanted(track, 14),
      }),
      box({
        left: x0,
        top: 596,
        width: Math.max(14, track * p),
        height: 14,
        background: "rgba(255,255,255,0.3)",
        clipPath: slanted(Math.max(14, track * p), 14),
      }),
      box({
        left: x0 + (track - thumb) * p,
        top: 589,
        width: thumb,
        height: 28,
        background: "#fff",
        clipPath: slanted(thumb, 28),
      }),
      box(
        {
          left: 1086,
          top: 582,
          width: 64,
          fontSize: 24,
          justifyContent: "flex-end",
          color: "rgba(255,255,255,0.66)",
        },
        mmss(length),
      ),
    ]) as never,
    {
      width: W,
      height: H,
      fonts: [{ name: "Saira", weight: 500, style: "normal", data: await font }],
    },
  );
  const jpeg = await sharp(Buffer.from(await base.arrayBuffer()))
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
});
