import { createHash } from "node:crypto";
import { defineHandler, HTTPError } from "nitro/h3";
import { canonicalSongId, isLevel } from "../../../src/catalog";
import { validMods } from "../../../src/modifiers";
import { REPLAY_SIGNED, replayDomain, replayHeader } from "../../../src/pigeon";
import { topics } from "../../../src/topics";
import { signed, verifySignature } from "../../auth";
import { note } from "../../log";
import { player } from "../../players";
import { announce, queueVerify } from "../../queue";
import { addReplay, REPLAY_DIR } from "../../replays";

// a registered player's replay that beat or tied their record, signed by the device that sent it. a verified one
// replaces an imported record of the same score. sending it again changes nothing
export default defineHandler(async (event) => {
  const { key, device, body } = await signed(event);
  const found = await player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  const data = body.subarray(0, -REPLAY_SIGNED);
  const signer = body.subarray(-REPLAY_SIGNED, -64);
  let header: ReturnType<typeof replayHeader>;
  try {
    header = replayHeader(data);
  } catch (error) {
    throw HTTPError.status(400, (error as Error).message);
  }
  const message = Buffer.concat([Buffer.from(replayDomain(header.version)), data]);
  if (!Buffer.from(signer).equals(device) || !verifySignature(device, message, body.subarray(-64)))
    throw HTTPError.status(400, "Not signed by this key");
  if (!validMods(header.mods, header.challenge)) throw HTTPError.status(400, "Bad modifiers");
  // PostgreSQL keeps no NUL in a text, and no replay of the game has one
  if (JSON.stringify(header).includes("\\u0000")) throw HTTPError.status(400, "Not a replay");
  // the game's song ids end in .0, the catalog's don't
  const song = canonicalSongId(header.id.replace(/\.0$/, ""));
  // the worker opens the chart by both: a ranked level, and a song that names a folder (maybe of a game update the
  // site doesn't have yet)
  if (!isLevel(header.difficulty) || /[/\\]|^\.{0,2}$/.test(song))
    throw HTTPError.status(400, "Not a ranked chart");
  const sha256 = createHash("sha256").update(body).digest("hex");
  await Bun.write(`${REPLAY_DIR}/${sha256}.pigeon`, body);
  await addReplay(sha256, key, song, header);
  // the versions a player's problem happened on, in the request's log line
  note(event, { phigrospp: header.phigrospp, game: header.game });
  await queueVerify(sha256);
  await announce(topics.player(found.id));
  return { id: sha256 };
});
