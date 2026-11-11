import type { PlayerName, PlayerProfile, PlayStatus } from "../src/plays";
import { sqlite } from "./db";
import "./replays"; // the bests and replays tables
import "./saves"; // the saves table

const card = sqlite.prepare<
  PlayerName & {
    key: Uint8Array;
    intro: string;
    background: string;
    rks: number;
    unlisted: number;
  },
  [string]
>(
  "SELECT key, id, name, number, avatar, background, intro, rks, unlisted FROM players WHERE id = ?",
);
const bestsOf = sqlite.prepare<
  {
    song: string;
    level: string;
    score: number;
    accuracy: number;
    fc: number;
    played: number | null;
    status: string | null;
    sha256: string | null;
  },
  [Uint8Array]
>(
  `SELECT b.song, b.level, b.score, b.accuracy, b.fc, b.played, r.status, b.sha256 FROM bests b
   LEFT JOIN replays r ON r.sha256 = b.sha256 WHERE b.key = ? ORDER BY b.score DESC`,
);
const hasSave = sqlite.prepare<{ updated: number }, [string]>(
  "SELECT updated FROM saves WHERE id = ?",
);

/** A player's page: their card, each chart's best (a replay or an imported record), and whether a save was uploaded. */
export function profilePage(id: string): PlayerProfile | undefined {
  const row = card.get(id);
  if (!row) return undefined;
  return {
    player: { id: row.id, name: row.name, number: row.number, avatar: row.avatar },
    intro: row.intro,
    background: row.background,
    rks: row.rks,
    unlisted: row.unlisted === 1,
    save: hasSave.get(id)?.updated ?? null,
    bests: bestsOf.all(row.key).map((best) => ({
      song: best.song,
      level: best.level,
      score: best.score,
      accuracy: best.accuracy,
      fc: best.fc === 1,
      date: best.played,
      status: (best.status ?? "imported") as PlayStatus,
      replay: best.sha256,
    })),
  };
}
