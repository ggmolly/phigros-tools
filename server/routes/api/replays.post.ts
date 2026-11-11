import { createHash } from "node:crypto";
import { defineHandler, HTTPError } from "nitro/h3";
import { canonicalSongId } from "../../../src/catalog";
import { REPLAY_DOMAIN, REPLAY_SIGNED, replayHeader } from "../../../src/pigeon";
import { signed, verifySignature } from "../../auth";
import { player } from "../../players";
import { queueVerify } from "../../queue";
import { addReplay, REPLAY_DIR } from "../../replays";

// a registered player's replay that beat or tied their record, signed by the same key as the request. a verified one
// replaces an imported record of the same score. sending it again changes nothing
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  if (!player(key)) throw HTTPError.status(403, "Not registered");
  const data = body.subarray(0, -REPLAY_SIGNED);
  const signer = body.subarray(-REPLAY_SIGNED, -64);
  const message = Buffer.concat([Buffer.from(REPLAY_DOMAIN), data]);
  if (
    body.length <= REPLAY_SIGNED ||
    !Buffer.from(signer).equals(key) ||
    !verifySignature(key, message, body.subarray(-64))
  )
    throw HTTPError.status(400, "Not signed by this key");
  let header: ReturnType<typeof replayHeader>;
  try {
    header = replayHeader(data);
  } catch (error) {
    throw HTTPError.status(400, (error as Error).message);
  }
  const sha256 = createHash("sha256").update(body).digest("hex");
  await Bun.write(`${REPLAY_DIR}/${sha256}.pigeon`, body);
  // the game's song ids end in .0, the catalog's don't
  addReplay(sha256, key, canonicalSongId(header.id.replace(/\.0$/, "")), header);
  await queueVerify(sha256);
  return { id: sha256 };
});
