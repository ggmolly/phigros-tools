import { versionNumber } from "../src/release";
import type { Note } from "../src/releases";
import built from "../src/releases.json";
import { IOS_DIR } from "./ios";

// the release notes of Phigros++ and of the site: releases/*.md, built into src/releases.json and public/releases/
// (scripts/build-releases.ts). the feed and the pages read them through /api/releases, the game too for what an
// update brings (mod/phigrospp/lua/update.lua), and the worker posts each one to Discord once (server/discord.ts)
const KEPT = 300_000; // how long the latest version is believed, in ms
let known: { version: string | null; at: number } | undefined;

/** The latest release of Phigros++, read in the header of what the worker keeps of it (server/ios.ts). */
export async function latest() {
  if (known && Date.now() - known.at < KEPT) return known.version;
  const file = Bun.file(`${IOS_DIR}/phigrospp.ios`);
  // "phigros++ ios <format> <version>" behind the 64 bytes of its signature
  const header = (await file.exists()) ? await file.slice(64, 192).text() : "";
  known = { version: header.split("\n")[0]!.split(" ")[3] ?? null, at: Date.now() };
  return known.version;
}

/** The notes to read, newest first: one written ahead for a release of Phigros++ waits for that release. */
export async function notes() {
  const version = await latest();
  return (built as Note[]).filter(
    ({ phigrospp }) => !phigrospp || !version || versionNumber(phigrospp) <= versionNumber(version),
  );
}
