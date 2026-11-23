import { defineHandler, getQuery } from "nitro/h3";
import { versionNumber } from "../../../../src/release";
import type { Releases } from "../../../../src/releases";
import { latest, notes } from "../../../releases";

// the release notes without what they say, newest first. ?after=<version> is what the game asks before an update:
// the notes of the releases of Phigros++ after that one, whole
export default defineHandler(async (event): Promise<Releases> => {
  const [version, all] = await Promise.all([latest(), notes()]);
  const { after } = getQuery(event);
  const from = versionNumber(String(after));
  return {
    version,
    notes: after
      ? all.filter(({ phigrospp }) => phigrospp && versionNumber(phigrospp) > from)
      : all.map(({ blocks, ...release }) => release),
  };
});
