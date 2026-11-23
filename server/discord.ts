import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { catalogSong } from "../src/catalog";
import type { Media } from "../src/mods";
import { LEVEL_COLORS, LEVELS } from "../src/modules";
import { releaseTag } from "../src/release";
import type { Note } from "../src/releases";
import { SITE } from "../src/seo";
import { config } from "./config";
import { notes } from "./releases";
import { chartPlays } from "./replays";

const TOP = 10; // the places worth a post

/**
 * Posts a verified replay that took a better place in a chart's top 10 to Discord, with the chart's podium card.
 * `was` is the player's place before it, undefined if they had none.
 */
export async function announceRank(sha256: string, song: string, level: string, was?: number) {
  if (!config.discord_webhook) return;
  // an unlisted player isn't in the ranking, so isn't announced either
  const { plays } = await chartPlays(0, song, level, TOP, 0);
  const play = plays.find((play) => play.replay === sha256);
  if (!play || (was && was <= play.rank)) return;
  const { title, constants } = catalogSong(song)!;
  const constant = constants[LEVELS.indexOf(level as (typeof LEVELS)[number])]!;
  const id = encodeURIComponent(song);
  // the query skips any cached card from before this play
  const card = await fetch(`${SITE}/og/plays/${id}/${level}.jpg?${sha256}`);
  if (!card.ok) throw new Error(`podium card: HTTP ${card.status}`);
  const name = `${play.player.name}#${String(play.player.number).padStart(4, "0")}`;
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `${name} took #${play.rank} on ${title} [${level} ${constant.toFixed(1)}]`,
          url: `${SITE}/charts/${id}/plays/${level}`,
          description: `${was ? `Up from #${was} with` : "With"} ${play.score.toLocaleString("en-US")} (${play.accuracy.toFixed(2)}%), [watch the replay](${SITE}/replays/${sha256})`,
          color: Number.parseInt(LEVEL_COLORS[level]!.slice(1), 16),
          image: { url: "attachment://podium.jpg" },
          footer: { text: "Verified replay" },
          timestamp: new Date(play.date!).toISOString(),
        },
      ],
    }),
  );
  form.append("files[0]", await card.blob(), "podium.jpg");
  await post(config.discord_webhook, form);
}

async function post(webhook: string, form: FormData) {
  const response = await fetch(webhook, { method: "POST", body: form });
  if (!response.ok) throw new Error(`discord: HTTP ${response.status} ${await response.text()}`);
}

const ANNOUNCED = "./data/releases"; // its announced.txt names the notes already posted, a line each
const GALLERY = 4; // the images Discord lays out as one embed's
const GLOW = 0x8fdcff;
const GOLD = 0xf5c94a; // a release of Phigros++, as its tag on the site

// how players get a release, said under its note
const IN_GAME = {
  name: "Updates in the game",
  value:
    "Open Phigros++ and tap the toast on the chapter screen, or Update in the Phigros++ settings.",
};
const INSTALLER = {
  name: "Needs the installer",
  value: `On Android, open the Phigros++ Installer and tap Update. On iPhone and iPad, patch the game again on [phigros.tools](${SITE}/phigrospp?device=ios).`,
};

/**
 * Posts a note as one message that tells everyone: its title, how it starts, its sections and how the release
 * reaches players, over its first images. Embeds of the same url are shown as one, their images side by side. The
 * images are sent with it: the site may not be up yet.
 */
export async function announceRelease(webhook: string, note: Note) {
  const url = `${SITE}/releases/${note.slug}`;
  const images = note.blocks.filter((block): block is Media => block.kind === "media");
  const sections = note.blocks.flatMap((block) =>
    block.kind === "heading" && block.level === 2
      ? [`- ${block.spans.map((span) => span.text).join("")}`]
      : [],
  );
  const form = new FormData();
  const [first, ...others] = images.slice(0, GALLERY).map(({ poster }, index) => {
    form.append(`files[${index}]`, Bun.file(`./public/releases/${poster}`), poster);
    return { url, image: { url: `attachment://${poster}` } };
  });
  form.append(
    "payload_json",
    JSON.stringify({
      content: note.phigrospp
        ? `@everyone — version ${note.phigrospp} released!`
        : "@everyone — phigros.tools was updated!",
      allowed_mentions: { parse: ["everyone"] },
      embeds: [
        {
          ...first,
          url,
          title: note.title,
          description: [note.summary, sections.join("\n")].filter(Boolean).join("\n\n"),
          color: note.phigrospp ? GOLD : GLOW,
          author: { name: releaseTag(note) },
          fields: note.phigrospp ? [note.installer ? INSTALLER : IN_GAME] : [],
        },
        ...others,
      ],
    }),
  );
  await post(webhook, form);
}

/**
 * Posts the newest release note Discord hasn't seen yet, once: what was posted is kept in data/, which a deploy
 * leaves alone. The older ones it hasn't seen are taken as told, so a first run or several notes at once make one
 * message. A post that fails is tried again the next time.
 */
export async function announceReleases() {
  if (!config.discord_releases) return;
  const file = `${ANNOUNCED}/announced.txt`;
  const done = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const fresh = (await notes()).filter((note) => !done.includes(note.slug));
  if (!fresh[0]) return;
  await announceRelease(config.discord_releases, fresh[0]);
  mkdirSync(ANNOUNCED, { recursive: true });
  appendFileSync(file, fresh.map((note) => `${note.slug}\n`).join(""));
}
