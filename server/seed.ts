import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { catalogManifest, catalogSongs } from "../src/catalog";
import { game } from "../src/game";
import { judge } from "../src/judge";
import { LEVELS } from "../src/modules";
import {
  decodeReplay,
  encodeReplay,
  REPLAY_SIGNED,
  type ReplayFrame,
  type ReplayHeader,
} from "../src/pigeon";
import { linePose, parseChart, type RawChart } from "../src/player/chart";
import { decodePhc } from "../src/player/phc";
import { GAME_DIR, loadGame } from "./game";
import { setLook, setName } from "./players";
import { addPlays } from "./profiles";
import { queueVerify } from "./queue";
import { importRecords } from "./records";
import { addReplay, REPLAY_DIR } from "./replays";

// fills a local database with players, their records and plays, and replays for the worker to judge: a bot plays
// each one on the chart, and a quarter of them claim a better result than its touches give. bun run seed [players]
loadGame();
const PLAYERS = Number(process.argv[2] ?? 300);
const W = 1920;
const H = 1080;
const FPS = 60;
const DT = Math.fround(1 / FPS);
const random = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;
const words = readFileSync("src/words.txt", "utf8").split("\n").filter(Boolean);
const capital = (word: string) => word[0]!.toUpperCase() + word.slice(1);

const charts = catalogSongs.flatMap((song) =>
  LEVELS.flatMap((level, i) => {
    const constant = song.constants[i];
    const stats = game().chartStats?.[song.id]?.[i];
    return constant && stats
      ? [{ song: song.id, level, constant, notes: stats.notes, length: stats.lengthSec }]
      : [];
  }),
);
type Chart = (typeof charts)[number];

/** what the game would show for a play of this accuracy: its judgements and score */
function result(chart: Chart, accuracy: number, fc: boolean) {
  const total = chart.notes;
  const broken = fc ? 0 : Math.ceil(random(1, total * (1 - accuracy / 100) + 2));
  const good = Math.max(0, Math.round((total * (1 - accuracy / 100) - broken) / 0.35));
  const perfect = Math.max(0, total - good - broken);
  const miss = Math.ceil(broken / 2);
  const maxcombo = fc ? total : Math.floor(random(0.2, 0.9) * total);
  return {
    perfect,
    good,
    bad: broken - miss,
    miss,
    maxcombo,
    ...scored(total, perfect, good, maxcombo),
  };
}

/** ScoreControl's score and accuracy */
function scored(total: number, perfect: number, good: number, maxcombo: number) {
  const accuracy = (perfect + good * 0.65) / total;
  return {
    accuracy: accuracy * 100,
    score: Math.round(accuracy * 900000 + (maxcombo / total) * 100000),
  };
}

const play = (chart: Chart, counts: ReturnType<typeof result>, date: number, mods = 0) =>
  JSON.stringify({
    song: chart.song,
    level: chart.level,
    ...counts,
    duration: chart.length,
    date,
    mods,
  });

/** touches a bot makes playing the chart, hitting `sigma` seconds off on average and missing a share of the notes */
function bot(raw: RawChart, sigma: number, misses: number): ReplayFrame[] {
  const { lines, duration } = parseChart(raw);
  const frames = Math.ceil((duration + 2) * FPS);
  const time = (k: number) => Math.fround(k / FPS - 1);
  const frame = (t: number) => Math.round((t + 1) * FPS);
  // a point along a line at t, in pixels from the bottom left; a world unit is a tenth of the screen's height
  const at = (line: (typeof lines)[number], t: number, along: number, across = 0) => {
    const { x, y, cos, sin } = linePose(line, t);
    return [
      Math.round(x * W + (along * cos - across * sin) * (H / 10)),
      Math.round((1 - y) * H - (along * sin + across * cos) * (H / 10)),
    ] as const;
  };
  const strokes: {
    start: number;
    end: number;
    id: number;
    pos: (k: number) => readonly [number, number];
  }[] = [];
  for (const line of lines)
    for (const note of line.notes) {
      if (Math.random() < misses) continue;
      const hit = frame(note.sec + random(-1, 1) * sigma * 1.7);
      const follow = (k: number) => at(line, time(k), note.x);
      if (note.type === 1)
        strokes.push({ start: hit, end: hit + 3, id: 0, pos: () => follow(hit) });
      else if (note.type === 3)
        strokes.push({ start: hit, end: frame(note.sec + note.holdSec) + 2, id: 0, pos: follow });
      else if (note.type === 2)
        strokes.push({ start: frame(note.sec) - 3, end: frame(note.sec) + 3, id: 0, pos: follow });
      // a flick rests, then swipes across its line fast enough for the game to see one
      else
        strokes.push({
          start: hit - 4,
          end: hit + 4,
          id: 0,
          pos: (k) => at(line, time(k), note.x, Math.max(0, k - hit + 2) * 0.4),
        });
    }
  strokes.sort((a, b) => a.start - b.start);
  // each finger takes the smallest id free, a lifted one's a frame after it went
  const taken: { id: number; free: number }[] = [];
  for (const stroke of strokes) {
    let id = 0;
    while (taken.some((t) => t.id === id && t.free >= stroke.start)) id++;
    stroke.id = id;
    taken.push({ id, free: stroke.end + 1 });
  }
  const list: ReplayFrame[] = [];
  let live: typeof strokes = [];
  let next = 0;
  for (let k = 0; k < frames; k++) {
    while (next < strokes.length && strokes[next]!.start <= k) live.push(strokes[next++]!);
    live = live.filter((s) => s.end >= k);
    const touches = live.map((s) => {
      const [x, y] = s.pos(k);
      const [lx, ly] = s.pos(k - 1);
      const phase = k === s.start ? 0 : k === s.end ? 3 : x !== lx || y !== ly ? 1 : 2;
      return { id: s.id, phase, x, y };
    });
    list.push({ t: time(k), dt: DT, touches });
  }
  return list;
}

async function replay(key: Uint8Array, chart: Chart, skill: number, cheat: boolean) {
  const raw = decodePhc(
    new Uint8Array(readFileSync(`${GAME_DIR}/chart-data/${chart.song}/${chart.level}.phc`)),
  );
  const gap = Math.max(0, chart.constant - skill);
  const frames = bot(raw, 0.015 + gap * 0.012, gap * 0.02);
  const header: ReplayHeader = {
    version: 5,
    id: `${chart.song}.0`,
    difficulty: chart.level,
    width: W,
    height: H,
    date: Math.floor(Date.now() / 1000 - random(0, 30 * 86400)),
    score: 0,
    accuracy: 0,
    maxcombo: 0,
    perfect: 0,
    good: 0,
    bad: 0,
    miss: 0,
    early: 0,
    late: 0,
    duration: frames.at(-1)!.t,
    game: catalogManifest.gameVersion,
    phigrospp: "0.3.0-beta.15",
    device: "Seeded",
    os: "Android 14",
    refresh: FPS,
    fps: FPS,
    offset: 0,
    files: "",
    dpi: 400,
    mirror: 0,
    challenge: 0,
    mods: 0,
    seed: 0,
  };
  // the replay is judged as the worker will read it back
  const judged = judge(raw, decodeReplay(encodeReplay(header, frames)).frames, header);
  const { perfect, good, bad, miss, maxcombo } = judged;
  const total = perfect + good + bad + miss;
  const counts = cheat
    ? {
        perfect: perfect + good + bad,
        good: 0,
        bad: 0,
        miss,
        maxcombo: Math.max(maxcombo, total - miss),
        early: 0,
        late: 0,
      }
    : { perfect, good, bad, miss, maxcombo, early: judged.early, late: judged.late };
  const { accuracy, score } = scored(total, counts.perfect, counts.good, counts.maxcombo);
  Object.assign(header, counts, {
    score: cheat ? score : judged.score,
    accuracy: Math.fround(accuracy),
  });
  const body = new Uint8Array([...encodeReplay(header, frames), ...new Uint8Array(REPLAY_SIGNED)]);
  const sha256 = createHash("sha256").update(body).digest("hex");
  await Bun.write(`${REPLAY_DIR}/${sha256}.pigeon`, body);
  await addReplay(sha256, key, chart.song, header);
  await queueVerify(sha256);
  return play(chart, { ...counts, score: header.score, accuracy }, header.date);
}

let replays = 0;
for (let n = 0; n < PLAYERS; n++) {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const name =
    Math.random() < 0.7
      ? capital(pick(words)) + capital(pick(words))
      : `${pick(words)}${Math.floor(random(1, 999))}`;
  await setName(key, name);
  await setLook(key, {
    intro: "",
    avatar: pick(Object.keys(game().avatars)),
    background: "",
    unlisted: Math.random() < 0.03,
  });
  // the chart constant they play around, most players in the middle
  const skill = 1 + 15.8 * Math.random() ** 0.8;
  const theirs = charts.filter((c) => c.constant <= skill + 1 && Math.random() < 0.6);
  const now = Date.now() / 1000;
  const records = theirs.map((chart) => {
    const gap = chart.constant - skill;
    const accuracy = Math.min(100, Math.max(60, 100 - Math.max(0, gap + 2) * 3 - random(0, 4)));
    const fc = accuracy > 97 && Math.random() < 0.5;
    return { chart, counts: result(chart, accuracy, fc) };
  });
  await importRecords(
    key,
    records
      .map(
        ({ chart, counts: c }) =>
          `${chart.song}.0\t${chart.level}\t${c.score}\t${c.accuracy}\t${+(c.bad + c.miss === 0)}`,
      )
      .join("\n"),
  );
  const plays = records
    .slice(0, 50)
    .map(({ chart, counts }) => play(chart, counts, now - random(0, 60 * 86400)));
  // the hardest charts they play, with their files, get replays
  const hardest = theirs
    .filter((c) => existsSync(`${GAME_DIR}/chart-data/${c.song}/${c.level}.phc`))
    .sort((a, b) => b.constant - a.constant)
    .slice(0, 10);
  for (let r = Math.floor(random(0, 4)); r > 0 && hardest.length; r--) {
    plays.push(await replay(key, pick(hardest), skill, Math.random() < 0.25));
    replays++;
  }
  await addPlays(key, plays.join("\n"));
}
console.log(`seeded ${PLAYERS} players and ${replays} replays`);
process.exit(0);
