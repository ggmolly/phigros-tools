import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import type { Block, Media, Mod } from "../src/mods";
import { config } from "./config";
import { log } from "./log";
import { shown } from "./media";
import { parse } from "./readme";

// the Phigros++ mod catalog. registry.txt (mod/scripts/registry.sh puts it here, signed for the game) lists the mods
// and their authors' keys, and the worker follows each one on GitHub: its latest release once its author's signature
// is checked, and its README as blocks the game draws (<repo>/readme.json) with the media it shows. what it found
// is index.json, read by the game and the Mods page. the game trusts the signed registry and the authors'
// signatures, never this listing
export const MODS_DIR = "./data/catalog";
const ASSET_CAP = 32 * 1024 * 1024; // as the game refuses bigger ones
const MEDIA_CAP = 64 * 1024 * 1024;
const DOMAIN = "phigros++ mod v1\0"; // what mod/scripts/sign-mod.mjs signs under
const SPKI = Buffer.from("302a300506032b6570032100", "hex"); // a raw ed25519 public key's der prefix
const WIDTH = 854;
const MEDIA_MAX = 8; // media of a README, the others aren't shown
const TEXT_MAX = 12000; // characters of a README
// where a README's media may come from: its own repo and what GitHub hosts for it, so the server fetches nothing else
const HOSTS =
  /^https:\/\/(raw\.githubusercontent\.com|user-images\.githubusercontent\.com|github\.com\/user-attachments\/assets|github\.com\/[\w.-]+\/[\w.-]+\/raw)\//;

interface Release {
  tag_name: string;
  published_at: string;
  assets: { name: string; browser_download_url: string }[];
}
interface Repo {
  name: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  owner: { login: string };
}

// what GitHub last answered for each address, with the tag it gave that answer. asked again with the tag, an
// unchanged answer comes back as a 304, which doesn't count against the hourly limit when asked with a token (it
// does without one)
const answers = new Map<string, { etag: string; body: string }>();

async function github(path: string, accept = "application/vnd.github+json"): Promise<string> {
  const known = answers.get(path);
  const response = await fetch(`https://api.github.com/repos/${path}`, {
    headers: {
      Accept: accept,
      "User-Agent": "phigros.tools",
      ...(known && { "If-None-Match": known.etag }),
      ...(config.github_token && { Authorization: `Bearer ${config.github_token}` }),
    },
  });
  if (known && response.status === 304) return known.body;
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);
  const body = await response.text();
  const etag = response.headers.get("etag");
  if (etag) answers.set(path, { etag, body });
  return body;
}

export async function download(url: string, cap: number) {
  const response = await fetch(url, { headers: { "User-Agent": "phigros.tools" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > cap)
    throw new Error(`${url} is too big`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length > cap) throw new Error(`${url} is too big`);
  return {
    data,
    type: (response.headers.get("content-type") ?? "").split(";")[0]!,
    etag: response.headers.get("etag") ?? undefined,
  };
}

function registry() {
  const authors = new Map<string, Buffer>();
  const repos: string[] = [];
  const file = `${MODS_DIR}/registry.txt`;
  for (const line of existsSync(file) ? readFileSync(file, "utf8").split("\n") : []) {
    const [author, key] = line.split(":");
    if (key) authors.set(author!, Buffer.from(key, "hex"));
    else if (line.includes("/")) repos.push(line);
  }
  return { authors, repos };
}

/** The Class.Method of each hook() call in a mod's Lua, null when one isn't written with a class and a method name. */
function hooksOf(file: string, data: Uint8Array): string[] | null {
  const sources =
    file === "mod.lua"
      ? [data]
      : Object.values(
          unzipSync(data, {
            filter: (entry) => entry.name.endsWith(".lua") && entry.originalSize < ASSET_CAP,
          }),
        );
  const hooks = new Set<string>();
  for (const source of sources.map((lua) => strFromU8(lua))) {
    const read = [...source.matchAll(/\bhook\s*\(\s*([\w.]+)\s*,\s*"(\w+)"/g)];
    if (read.length !== (source.match(/\bhook\s*\(/g)?.length ?? 0)) return null;
    for (const [, target, method] of read) hooks.add(`${target!.split(".").pop()}.${method}`);
  }
  return [...hooks].sort();
}

/** A release's asset once its author signed it for this repo and tag: an unsigned or forged one is never listed. */
async function release(repo: string, key: Buffer, { tag_name: tag, assets }: Release) {
  const asset =
    assets.find(({ name }) => name === "mod.zip") ?? assets.find(({ name }) => name === "mod.lua");
  const sig = assets.find(({ name }) => name === `${asset?.name}.sig`);
  if (!asset || !sig) throw new Error("its latest release has no mod.zip or mod.lua with its .sig");
  const [{ data }, { data: signed }] = await Promise.all([
    download(asset.browser_download_url, ASSET_CAP),
    download(sig.browser_download_url, 96),
  ]);
  const message = Buffer.concat([
    Buffer.from(`${DOMAIN}${repo}\0${tag}\0`),
    createHash("sha512").update(data).digest(),
  ]);
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI, key]),
    format: "der",
    type: "spki",
  });
  if (
    signed.length !== 96 ||
    !key.equals(signed.subarray(0, 32)) ||
    !verify(null, message, publicKey, signed.subarray(32))
  )
    throw new Error("its latest release isn't signed by its author's key");
  return { file: asset.name as Mod["file"], size: data.length, hooks: hooksOf(asset.name, data) };
}

/** A poster of something a README shows, and a short muted clip of a video or a GIF. Nothing without ffmpeg. */
async function media(repo: string, src: string): Promise<Media | undefined> {
  const { data, type, etag } = await download(src, MEDIA_CAP);
  const made = await shown(`${MODS_DIR}/${repo}`, data, type, WIDTH);
  return (
    made && {
      ...made,
      kind: "media",
      src,
      etag,
      poster: `${repo}/${made.poster}`,
      clip: made.clip && `${repo}/${made.clip}`,
    }
  );
}

// whether a medium is still what its address serves. the address is only asked for its tag, and one that doesn't
// answer is taken as unchanged
const same = (known: Media) =>
  fetch(known.src, { method: "HEAD", headers: { "User-Agent": "phigros.tools" } }).then(
    (response) => !response.ok || response.headers.get("etag") === known.etag,
    () => true,
  );

/** A README as blocks, written to <repo>/readme.json for the mod's page. A medium is made again when it changed. */
async function document(repo: string, readme: string, branch: string): Promise<Block[]> {
  const file = `${MODS_DIR}/${repo}/readme.json`;
  const old: Block[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const blocks: Block[] = [];
  let shown = 0;
  const drafts = parse(
    readme.slice(0, TEXT_MAX),
    `https://raw.githubusercontent.com/${repo}/${branch}/`,
    `https://github.com/${repo}/blob/${branch}/`,
    HOSTS,
  );
  for (const draft of drafts) {
    if (draft.kind !== "media") blocks.push(draft);
    else if (shown++ < MEDIA_MAX) {
      const { src } = draft;
      const known = old.find(
        (block): block is Media => block.kind === "media" && block.src === src,
      );
      // one that can't be read keeps what was made of it, or is left out and tried again next time
      const made =
        known && (await same(known))
          ? known
          : ((await media(repo, src).catch((error) =>
              log.warn("mods.media.failed", { repo, src, error }),
            )) ?? known);
      if (made) blocks.push(made);
    }
  }
  mkdirSync(`${MODS_DIR}/${repo}`, { recursive: true });
  writeFileSync(`${file}.new`, JSON.stringify(blocks));
  renameSync(`${file}.new`, file);
  return blocks;
}

const textOf = (block: Block) =>
  "spans" in block ? block.spans.map((span) => span.text).join("") : "";

// the asset is only fetched again for a new tag
async function refresh(repo: string, key: Buffer, old?: Mod): Promise<Mod> {
  const [info, latest, readme] = await Promise.all([
    github(repo).then((body) => JSON.parse(body) as Repo),
    github(`${repo}/releases/latest`).then((body) => JSON.parse(body) as Release),
    github(`${repo}/readme`, "application/vnd.github.raw+json"),
  ]);
  const asset = latest.tag_name === old?.version ? old : await release(repo, key, latest);
  const blocks = await document(repo, readme, info.default_branch);
  // the README's title when it has one (a repository's name is rarely how its mod is called), and its text up to
  // its next heading
  const [first, ...rest] = blocks;
  const title = first?.kind === "heading" && first.level === 1;
  const body = title ? rest : blocks;
  const end = body.findIndex((block) => block.kind === "heading");
  const intro = (end < 0 ? body : body.slice(0, end)).map(textOf).filter(Boolean);
  const shown = blocks.find((block): block is Media => block.kind === "media");
  return {
    repo,
    name: (title && textOf(first)) || info.name,
    author: info.owner.login,
    description: intro.join("\n\n").slice(0, 600) || (info.description ?? ""),
    version: latest.tag_name,
    file: asset.file,
    size: asset.size,
    stars: info.stargazers_count,
    updated: latest.published_at,
    poster: shown?.poster,
    clip: shown?.clip,
    hooks: asset.hooks,
  };
}

const INDEX = `${MODS_DIR}/index.json`;

/** The catalog as it was last written. */
export const listedMods = (): Mod[] =>
  existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")).mods : [];

/** Follows every mod of the registry. One that can't be read keeps what was known of it, a new one stays unlisted. */
export async function refreshMods() {
  const { authors, repos } = registry();
  const old = listedMods();
  const mods: Mod[] = [];
  for (const repo of repos) {
    const known = old.find((mod) => mod.repo === repo);
    try {
      mods.push(await refresh(repo, authors.get(repo.split("/")[0]!)!, known));
    } catch (error) {
      log.warn("mods.refresh.failed", { repo, error });
      if (known) mods.push(known);
    }
  }
  mods.sort((a, b) => b.stars - a.stars);
  mkdirSync(MODS_DIR, { recursive: true });
  writeFileSync(`${INDEX}.new`, JSON.stringify({ mods }));
  renameSync(`${INDEX}.new`, INDEX);
}
