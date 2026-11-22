import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { opened } from "../src/release";
import { download } from "./mods";

// what the Phigros++ page patches the game's ipa with (mod/scripts/build-ios.ts). GitHub sends a release's files
// without CORS headers, so the worker keeps the latest release's here once the release key's signature is checked,
// and the page checks it again: it never trusts this copy
export const IOS_DIR = "./data/ios";
const SOURCE = "https://github.com/ggmolly/PhigrosPlusPlus/releases/latest/download/phigrospp.ios";
const CAP = 32 * 1024 * 1024;

export async function refreshIos() {
  const { data } = await download(SOURCE, CAP);
  await opened(data);
  const file = `${IOS_DIR}/phigrospp.ios`;
  // an unchanged file keeps its date, which is how browsers know theirs is still good
  if (existsSync(file) && readFileSync(file).equals(data)) return;
  mkdirSync(IOS_DIR, { recursive: true });
  writeFileSync(`${file}.tmp`, data);
  renameSync(`${file}.tmp`, file);
}
