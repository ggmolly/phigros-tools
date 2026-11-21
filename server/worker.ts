import { existsSync, readFileSync } from "node:fs";
import { catalogManifest } from "../src/catalog";
import { judge, timingAccuracy } from "../src/judge";
import { Mod, modChart } from "../src/modifiers";
import { decodeReplay } from "../src/pigeon";
import { decodePhc } from "../src/player/phc";
import { topics } from "../src/topics";
import { sqlite } from "./db";
import { announceRank } from "./discord";
import { refreshMods } from "./mods";
import { playerId } from "./players";
import { addAchievement, snapshotHistory } from "./profiles";
import { announce, openQueue, VERIFY_QUEUE } from "./queue";
import { chartPlace, countReplay, REPLAY_DIR } from "./replays";

// judges uploaded replays like the game did, with the modifiers they were played with, and marks them verified when
// the game's recorded result is what their touches give, unverified otherwise (with both results). only a verified
// one counts on the leaderboard. it also keeps
// the players' daily RKS history. a replay of a game version whose charts the site doesn't
// have stays pending. it also keeps the mod catalog up to date. run beside the server: bun worker.mjs
const CHARTS = process.env.CHART_DIR ?? "./public/chart-data";
const RESULT = ["score", "maxcombo", "perfect", "good", "bad", "miss", "early", "late"] as const;

const replay = sqlite.prepare<
  { key: Uint8Array; song: string; level: string; status: string },
  [string]
>("SELECT key, song, level, status FROM replays WHERE sha256 = ?");
const pending = sqlite.prepare<{ sha256: string }, []>(
  "SELECT sha256 FROM replays WHERE status = 'pending'",
);
const settle = sqlite.prepare<unknown, [string, string, number | null, string]>(
  "UPDATE replays SET status = ?, result = ?, timing = ? WHERE sha256 = ?",
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
  const { mods, seed, mirror } = header;
  const played = modChart(decodePhc(new Uint8Array(readFileSync(chart))), mods, seed, mirror === 1);
  const judged = judge(played, frames, header);
  const recorded = Object.fromEntries(RESULT.map((field) => [field, header[field]]));
  const replayed = Object.fromEntries(RESULT.map((field) => [field, judged[field]]));
  // Sudden Death ends a play at its first bad or miss and Perfect restarts it at its first good, so neither records
  // a replay that has one
  const broken =
    (mods & Mod.SD && judged.bad + judged.miss) ||
    (mods & Mod.PF && judged.good + judged.bad + judged.miss);
  const same = !broken && RESULT.every((field) => recorded[field] === replayed[field]);
  const result = JSON.stringify({ recorded, replayed });
  const timing = timingAccuracy(judged.hits, mods);
  settle.run(same ? "verified" : "unverified", result, timing, sha256);
  if (same) {
    const was = chartPlace(row.key, row.song, row.level);
    const { key, song, level, raised } = countReplay(sha256, header);
    if (raised) {
      addAchievement(key, song, level, header.score);
      announceRank(sha256, song, level, was).catch((error) =>
        console.error(`${sha256} not announced:`, error),
      );
    }
    void announce(topics.chart(song, level));
    void announce(topics.ranking);
  }
  void announce(topics.player(playerId(row.key)));
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

// the mod catalog follows its mods' releases and READMEs on GitHub
const followMods = () =>
  refreshMods().catch((error) => console.error("mods not refreshed:", error));
void followMods();
setInterval(followMods, 900_000);

const channel = await openQueue();
// the broker went away: exit so the container restarts and reconnects, the queue keeps what came meanwhile
channel.on("close", () => process.exit(1));
await channel.prefetch(1);
// what was uploaded while no worker ran, then what comes
for (const { sha256 } of pending.all()) attempt(sha256);
await channel.consume(VERIFY_QUEUE, (message) => {
  if (!message) return;
  attempt(message.content.toString());
  channel.ack(message);
});
console.log(`judging replays from ${VERIFY_QUEUE}`);
