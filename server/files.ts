import { existsSync, statSync } from "node:fs";
import { HTTPError } from "nitro/h3";

const TYPES: Record<string, string> = {
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  jpg: "image/jpeg",
  avif: "image/avif",
  ttf: "font/ttf",
  webm: "audio/webm",
  mp4: "video/mp4",
};

/**
 * A file of a folder of data/, which is filled without a deploy. A path leaving the folder or naming a hidden file
 * is a 404. Answers a range when asked for one: Safari plays no video without.
 */
export async function serveFile(dir: string, path: string, request: Request): Promise<Response> {
  const file = `${dir}/${path}`;
  if (
    path.split("/").some((part) => !part || part.startsWith(".")) ||
    !existsSync(file) ||
    !statSync(file).isFile()
  )
    throw HTTPError.status(404);
  const { size, mtimeMs } = statSync(file);
  const etag = `"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers: { etag } });
  const headers = {
    "content-type": TYPES[path.split(".").pop()!] ?? "application/octet-stream",
    "cache-control": "public, max-age=300",
    "accept-ranges": "bytes",
    etag,
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!range || !(range[1] || range[2])) return new Response(Bun.file(file), { headers });
  // "a-b", "a-" to the end, or "-n" for the last n bytes
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end)
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  // read here: a sliced file given as the body is sent up to the file's end
  return new Response(
    await Bun.file(file)
      .slice(start, end + 1)
      .arrayBuffer(),
    {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}` },
    },
  );
}
