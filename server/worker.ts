import { existsSync, readFileSync } from "node:fs";
import { catalogManifest } from "../src/catalog";
import { judge } from "../src/judge";
import { decodeReplay } from "../src/pigeon";
import { decodePhc } from "../src/player/phc";
import { sqlite } from "./db";
import { addAchievement, snapshotHistory } from "./profiles";
import { openQueue, VERIFY_QUEUE } from "./queue";
import { countReplay, REPLAY_DIR } from "./replays";

// judges uploaded replays like the game did and marks them verified when the game's recorded result is what their
// touches give, unverified otherwise (with both results). only a verified one counts on the leaderboard. it also keeps
// the players' daily RKS history. a replay of a game version whose charts the site doesn't
// have stays pending. run beside the server: bun worker.mjs
const CHARTS = process.env.CHART_DIR ?? "./public/chart-data";
const RESULT = ["score", "maxcombo", "perfect", "good", "bad", "miss", "early", "late"] as const;

const replay = sqlite.prepare<{ song: string; level: string; status: string }, [string]>(
  "SELECT song, level, status FROM replays WHERE sha256 = ?",
);
const pending = sqlite.prepare<{ sha256: string }, []>(
  "SELECT sha256 FROM replays WHERE status = 'pending'",
);
const settle = sqlite.prepare<unknown, [string, string, string]>(
  "UPDATE replays SET status = ?, result = ? WHERE sha256 = ?",
);

function verify(sha256: string) {
  const row = replay.get(sha256);
  if (row?.status !== "pending") return;
  const { header, frames } = decodeReplay(
    new Uint8Array(readFileSync(`${REPLAY_DIR}/${sha256}.pigeon`)),
    true,
  );
  const chart = `${CHARTS}/${row.song}/${row.level}.phc`;
  if (header.game !== catalogManifest.gameVersion || !existsSync(chart)) return;
  const judged = judge(decodePhc(new Uint8Array(readFileSync(chart))), frames, header);
  const recorded = Object.fromEntries(RESULT.map((field) => [field, header[field]]));
  const replayed = Object.fromEntries(RESULT.map((field) => [field, judged[field]]));
  const same = RESULT.every((field) => recorded[field] === replayed[field]);
  settle.run(same ? "verified" : "unverified", JSON.stringify({ recorded, replayed }), sha256);
  if (!same) return;
  const { key, song, level, raised } = countReplay(sha256, header);
  if (raised) addAchievement(key, song, level, header.score);
  console.log(`${sha256} ${row.song} ${row.level}: ${same ? "verified" : "unverified"}`);
}

function attempt(sha256: string) {
  try {
    verify(sha256);
  } catch (error) {
    console.error(`${sha256} could not be judged:`, error);
  }
}

// every player's RKS and rank of the day, kept hourly so the day's last one stays
snapshotHistory();
setInterval(snapshotHistory, 3_600_000);

const channel = await openQueue();
await channel.prefetch(1);
// what was uploaded while no worker ran, then what comes
for (const { sha256 } of pending.all()) attempt(sha256);
await channel.consume(VERIFY_QUEUE, (message) => {
  if (!message) return;
  attempt(message.content.toString());
  channel.ack(message);
});
console.log(`judging replays from ${VERIFY_QUEUE}`);
