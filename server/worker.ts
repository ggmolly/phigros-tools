import { existsSync, readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { catalogManifest } from "../src/catalog";
import { judge, timingAccuracy } from "../src/judge";
import { Mod, modChart, rateOf } from "../src/modifiers";
import { decodeReplay, type ReplayFrame } from "../src/pigeon";
import { decodePhc } from "../src/player/phc";
import { topics } from "../src/topics";
import { db, lock } from "./db";
import { announceRank, announceReleases } from "./discord";
import { expireEvents } from "./events";
import { followGame, GAME_DIR, loadGame } from "./game";
import { refreshIos } from "./ios";
import { flush, log } from "./log";
import { refreshMods } from "./mods";
import { playerId } from "./players";
import { addAchievement, snapshotHistory } from "./profiles";
import { announce, CATALOG_QUEUE, openQueue, VERIFY_QUEUE } from "./queue";
import { chartPlace, countReplay, REPLAY_DIR } from "./replays";
import { replays } from "./schema";

// judges uploaded replays like the game did, with the modifiers they were played with, and marks them verified when
// the game's recorded result is what their touches give, unverified otherwise (with both results). only a verified
// one counts on the leaderboard. it also keeps
// the players' daily RKS history. a replay of a game version whose charts the site doesn't
// have stays pending. it also keeps the mod catalog and what patches the ios game up to date. run beside the server:
// bun worker.mjs
loadGame();
const CHARTS = `${GAME_DIR}/chart-data`;
const RESULT = ["score", "maxcombo", "perfect", "good", "bad", "miss", "early", "late"] as const;

// how fast the song ran against real time: the median of what a frame's song time moved over its delta time, which
// stays within 0.2% of the speed played at on every device seen
function pace(frames: ReplayFrame[]) {
  const steps = frames.slice(1).map((frame, i) => (frame.t - frames[i]!.t) / frame.dt);
  return steps.sort((a, b) => a - b)[steps.length >> 1] ?? 1;
}
const PACE = 0.02; // how far from its modifiers' speed a replay may run

async function verify(sha256: string) {
  const [row] = await db.select().from(replays).where(eq(replays.sha256, sha256));
  if (row?.status !== "pending") return;
  const began = performance.now();
  const { header, frames } = decodeReplay(
    new Uint8Array(readFileSync(`${REPLAY_DIR}/${sha256}.pigeon`)),
    true,
  );
  const chart = `${CHARTS}/${row.song}/${row.level}.phc`;
  const { key, song, level } = row;
  if (header.game !== catalogManifest.gameVersion || !existsSync(chart))
    return log.info("replay.skipped", { sha256, song, difficulty: level, game: header.game });
  const { mods, seed, mirror } = header;
  const played = modChart(decodePhc(new Uint8Array(readFileSync(chart))), mods, seed, mirror === 1);
  const judged = judge(played, frames, header);
  const recorded = Object.fromEntries(RESULT.map((field) => [field, header[field]]));
  const replayed = Object.fromEntries(RESULT.map((field) => [field, judged[field]]));
  // Sudden Death ends a play at its first bad or miss and Perfect restarts it at its first good, so neither records
  // a replay that has one. and one with modifiers ran at their speed: Nightcore's score isn't for a song played slower
  const broken =
    (mods & Mod.SD && judged.bad + judged.miss) ||
    (mods & Mod.PF && judged.good + judged.bad + judged.miss) ||
    (mods && Math.abs(pace(frames) / rateOf(mods) - 1) > PACE);
  const same = !broken && RESULT.every((field) => recorded[field] === replayed[field]);
  const status = same ? "verified" : "unverified";
  const timing = timingAccuracy(judged.hits, mods);
  // judged and counted at once: a replay marked verified is on the leaderboard
  const counted = await db.transaction(async (tx) => {
    await lock(tx, key);
    const settled = await tx
      .update(replays)
      .set({ status, result: { recorded, replayed }, timing })
      .where(and(eq(replays.sha256, sha256), eq(replays.status, "pending")))
      .returning({ sha256: replays.sha256 });
    if (!settled.length || !same) return;
    const was = await chartPlace(tx, key, song, level);
    const raised = await countReplay(tx, row, header);
    if (raised) await addAchievement(tx, key, song, level, header.score);
    return { was, raised };
  });
  if (counted?.raised)
    announceRank(sha256, song, level, counted.was).catch((error) =>
      log.warn("discord.failed", { sha256, error }),
    );
  if (counted) {
    void announce(topics.chart(song, level));
    void announce(topics.ranking);
  }
  void announce(topics.player(playerId(key)));
  const ms = Math.round(performance.now() - began);
  const player = playerId(key);
  log.info("replay.judged", { sha256, player, song, difficulty: level, status, mods, ms });
}

const attempt = (sha256: string) =>
  verify(sha256).catch((error) => log.error("replay.failed", { sha256, error }));

// every player's RKS and rank of the day, kept hourly so the day's last one stays. and the pages seen keep 90 days
const HOUR = 3_600_000;
const hourly = () =>
  Promise.all([snapshotHistory(), expireEvents()]).catch((error) =>
    log.error("hourly.failed", { error }),
  );
void hourly();
setInterval(hourly, HOUR);

// the mod catalog follows its mods' releases and READMEs on GitHub, and what patches the ios game the releases of
// Phigros++, whose notes are posted to Discord as they come out
const follow = (what: string, refresh: () => Promise<unknown>) => () =>
  refresh().catch((error) => log.warn("refresh.failed", { what, error }));
let reading: Promise<unknown> | undefined;
const mods = () => (reading ??= follow("mods", refreshMods)().finally(() => (reading = undefined)));
for (const run of [
  mods,
  // a note waits for its release, read in the pack, so a new pack is kept before its note is posted
  () => follow("phigrospp.ios", refreshIos)().then(follow("releases", announceReleases)),
]) {
  void run();
  setInterval(run, 900_000);
}

// the catalog is also read when asked (POST /api/catalog, once a mod's release is out), at most once a minute: an
// ask within the minute is answered at its end
let asked = 0;
let soon: ReturnType<typeof setTimeout> | undefined;
function ask() {
  if (soon) return;
  soon = setTimeout(
    () => {
      soon = undefined;
      asked = Date.now();
      void mods();
    },
    Math.max(0, asked + 60_000 - Date.now()),
  );
}

const channel = await openQueue();
// the broker went away: exit so the container restarts and reconnects, the queue keeps what came meanwhile
channel.on("close", async () => {
  log.error("queue.lost");
  await flush();
  process.exit(1);
});
await channel.prefetch(1);
await channel.consume(CATALOG_QUEUE, (message) => {
  if (!message) return;
  channel.ack(message);
  ask();
});
// what was uploaded while no worker ran, then what comes
const pending = await db
  .select({ sha256: replays.sha256 })
  .from(replays)
  .where(eq(replays.status, "pending"));
for (const { sha256 } of pending) await attempt(sha256);
// a game update brings the charts the replays of its version waited for
followGame(async () => {
  const waiting = await db
    .select({ sha256: replays.sha256 })
    .from(replays)
    .where(eq(replays.status, "pending"));
  for (const { sha256 } of waiting) await attempt(sha256);
});
// one at a time: the next is only handed over once this one is judged
await channel.consume(VERIFY_QUEUE, (message) => {
  if (message) void attempt(message.content.toString()).then(() => channel.ack(message));
});
log.info("start", { queue: VERIFY_QUEUE, pending: pending.length });
