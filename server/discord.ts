import { catalogSong } from "../src/catalog";
import { LEVEL_COLORS, LEVELS } from "../src/modules";
import { SITE } from "../src/seo";
import { chartPlays } from "./replays";

const WEBHOOK = process.env.DISCORD_WEBHOOK;
const TOP = 10; // the places worth a post

/**
 * Posts a verified replay that took a better place in a chart's top 10 to Discord, with the chart's podium card.
 * `was` is the player's place before it, undefined if they had none.
 */
export async function announceRank(sha256: string, song: string, level: string, was?: number) {
  if (!WEBHOOK) return;
  // an unlisted player isn't in the ranking, so isn't announced either
  const play = chartPlays(0, song, level, TOP, 0).plays.find((play) => play.replay === sha256);
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
  const response = await fetch(WEBHOOK, { method: "POST", body: form });
  if (!response.ok) throw new Error(`discord: HTTP ${response.status} ${await response.text()}`);
}
