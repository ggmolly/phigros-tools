import { canonicalSongId, catalogRevision } from "./catalog";
import type { SaveDocumentV1 } from "./document";
import { calculateRanking, rulesetForGameVersion } from "./metrics";
import { countLevels, LEVELS, type LevelRecord } from "./modules";
import type { SnapshotV1 } from "./store";

export interface SnapshotChange {
  key: string;
  songId: string;
  level: (typeof LEVELS)[number];
  kind: "new" | "changed";
  scoreDelta: number;
  accuracyDelta: number;
  fc: "gained" | "lost" | "same";
  phi: "gained" | "lost" | "same";
}

type Comparable = Pick<SaveDocumentV1, "songs">;

function records(document: Comparable) {
  const result = new Map<
    string,
    { songId: string; level: number; record: LevelRecord; fc: boolean }
  >();
  for (const song of document.songs) {
    const songId = canonicalSongId(song.songId);
    song.levels.forEach((record, level) => {
      if (record)
        result.set(`${songId}:${level}`, {
          songId,
          level,
          record,
          fc: Boolean((song.fc >> level) & 1),
        });
    });
  }
  return result;
}

export function compareDocuments(older: Comparable, newer: Comparable): SnapshotChange[] {
  const before = records(older);
  const after = records(newer);
  const changes: SnapshotChange[] = [];
  for (const [key, current] of after) {
    const previous = before.get(key);
    if (!previous) {
      changes.push({
        key,
        songId: current.songId,
        level: LEVELS[current.level]!,
        kind: "new",
        scoreDelta: current.record.score,
        accuracyDelta: current.record.accuracy,
        fc: current.fc ? "gained" : "same",
        phi: current.record.accuracy >= 100 ? "gained" : "same",
      });
      continue;
    }
    const scoreDelta = current.record.score - previous.record.score;
    const accuracyDelta = current.record.accuracy - previous.record.accuracy;
    const fc = current.fc === previous.fc ? "same" : current.fc ? "gained" : "lost";
    const wasPhi = previous.record.accuracy >= 100;
    const isPhi = current.record.accuracy >= 100;
    const phi = wasPhi === isPhi ? "same" : isPhi ? "gained" : "lost";
    if (scoreDelta || accuracyDelta || fc !== "same" || phi !== "same") {
      changes.push({
        key,
        songId: current.songId,
        level: LEVELS[current.level]!,
        kind: "changed",
        scoreDelta,
        accuracyDelta,
        fc,
        phi,
      });
    }
  }
  return changes.sort(
    (a, b) =>
      b.accuracyDelta - a.accuracyDelta ||
      b.scoreDelta - a.scoreDelta ||
      a.key.localeCompare(b.key),
  );
}

export interface RksPoint {
  capturedAt: string;
  rks: number;
}

/** RKS per snapshot, oldest first; empty unless at least two comparable snapshots (same ruleset, current catalog). */
export function rksSeries(history: SnapshotV1[], currentRevision: string): RksPoint[] {
  const rulesets = new Set(
    history.map((snapshot) => rulesetForGameVersion(snapshot.document.summary?.gameVersion)),
  );
  if (
    history.length < 2 ||
    rulesets.size > 1 ||
    !history.every((snapshot) => snapshot.catalogRevision === currentRevision)
  )
    return [];
  return history
    .map((snapshot) => ({
      capturedAt: snapshot.capturedAt,
      rks: calculateRanking(snapshot.document).rankingScore,
    }))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export function snapshotProgress(previous: SnapshotV1, latest: SnapshotV1) {
  const older = countLevels(previous.document.songs);
  const newer = countLevels(latest.document.songs);
  const delta = (key: "fc" | "phi") =>
    newer.reduce((sum, level) => sum + level[key], 0) -
    older.reduce((sum, level) => sum + level[key], 0);
  const comparable =
    previous.playerId === latest.playerId &&
    previous.catalogRevision === catalogRevision &&
    latest.catalogRevision === catalogRevision &&
    rulesetForGameVersion(previous.document.summary?.gameVersion) ===
      rulesetForGameVersion(latest.document.summary?.gameVersion);
  return {
    rks: comparable
      ? calculateRanking(latest.document).rankingScore -
        calculateRanking(previous.document).rankingScore
      : undefined,
    fc: delta("fc"),
    ap: delta("phi"),
    improvements: compareDocuments(previous.document, latest.document).filter(
      (change) =>
        change.kind === "new" ||
        change.scoreDelta > 0 ||
        change.accuracyDelta > 0 ||
        change.fc === "gained" ||
        change.phi === "gained",
    ),
  };
}
