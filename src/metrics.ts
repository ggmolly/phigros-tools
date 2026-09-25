import { type CatalogSong, canonicalSongId, catalogSong, catalogSongs } from "./catalog";
import { LEVELS, type SongRecord, type Summary } from "./modules";

export type Ruleset = "legacy-b19" | "b30";
const SLOTS: Record<Ruleset, { best: number; phi: number }> = {
  b30: { best: 27, phi: 3 },
  "legacy-b19": { best: 19, phi: 1 },
};

export interface ChartMetric {
  key: string;
  songId: string;
  title: string;
  artist: string;
  level: (typeof LEVELS)[number];
  levelIndex: number;
  constant: number;
  score: number;
  accuracy: number;
  fc: boolean;
  phi: boolean;
  rks: number;
}

export interface RankingResult {
  ruleset: Ruleset;
  rankingScore: number;
  best: ChartMetric[];
  phi: ChartMetric[];
  cutoff: number;
  divisor: number;
  charts: ChartMetric[];
}

/** Verified current formula: records below 70% contribute zero. */
export function chartRks(accuracy: number, constant: number): number {
  if (accuracy < 70) return 0;
  if (accuracy >= 100) return constant;
  return constant * ((accuracy - 55) / 45) ** 2;
}

function accuracyForRks(rks: number, constant: number): number | undefined {
  if (constant <= 0 || rks < 0 || rks > constant) return undefined;
  if (rks === 0) return 70;
  const accuracy = 55 + 45 * Math.sqrt(rks / constant);
  return accuracy <= 100 ? Math.max(70, accuracy) : undefined;
}

export function rulesetForGameVersion(gameVersion?: number): Ruleset {
  // Phigros 3.11.0 is save gameVersion 122 and introduced 3 Phi + B27.
  return gameVersion !== undefined && gameVersion < 122 ? "legacy-b19" : "b30";
}

function order(a: ChartMetric, b: ChartMetric) {
  return b.rks - a.rks || a.songId.localeCompare(b.songId) || a.levelIndex - b.levelIndex;
}

function chartMetrics(document: {
  songs: readonly Pick<SongRecord, "songId" | "fc" | "levels">[];
}): ChartMetric[] {
  const charts: ChartMetric[] = [];
  for (const song of document.songs) {
    const metadata = catalogSong(song.songId);
    if (!metadata) continue;
    song.levels.forEach((record, levelIndex) => {
      const constant = metadata.constants[levelIndex];
      if (!record || constant === null || constant === undefined) return;
      charts.push({
        key: `${song.songId}:${LEVELS[levelIndex]}`,
        songId: song.songId,
        title: metadata.title,
        artist: metadata.artist,
        level: LEVELS[levelIndex]!,
        levelIndex,
        constant,
        score: record.score,
        accuracy: record.accuracy,
        fc: Boolean((song.fc >> levelIndex) & 1),
        phi: record.accuracy >= 100,
        rks: chartRks(record.accuracy, constant),
      });
    });
  }
  return charts.sort(order);
}

/** A zero record for a catalog chart the player hasn't played. */
export function blankChart(song: CatalogSong, levelIndex: number, constant: number): ChartMetric {
  return {
    key: `${song.id}:${LEVELS[levelIndex]}`,
    songId: song.id,
    title: song.title,
    artist: song.artist,
    level: LEVELS[levelIndex]!,
    levelIndex,
    constant,
    score: 0,
    accuracy: 0,
    fc: false,
    phi: false,
    rks: 0,
  };
}

function rankCharts(charts: ChartMetric[], ruleset: Ruleset): RankingResult {
  charts.sort(order);
  const slots = SLOTS[ruleset];
  const divisor = slots.best + slots.phi;
  const best = charts.slice(0, slots.best);
  const phi = charts.filter((chart) => chart.phi).slice(0, slots.phi);
  const rankingScore = [...best, ...phi].reduce((sum, chart) => sum + chart.rks, 0) / divisor;
  return { ruleset, rankingScore, best, phi, cutoff: best.at(-1)?.rks ?? 0, divisor, charts };
}

export function calculateRanking(
  document: { songs: readonly Pick<SongRecord, "songId" | "fc" | "levels">[]; summary?: Summary },
  ruleset = rulesetForGameVersion(document.summary?.gameVersion),
): RankingResult {
  return rankCharts(chartMetrics(document), ruleset);
}

export function projectAccuracy(
  result: RankingResult,
  key: string,
  accuracy: number,
): RankingResult {
  if (accuracy < 0 || accuracy > 100) throw new Error("Target accuracy must be between 0 and 100");
  return rankCharts(
    result.charts.map((chart) =>
      chart.key === key
        ? {
            ...chart,
            accuracy,
            phi: accuracy >= 100,
            rks: chartRks(accuracy, chart.constant),
          }
        : { ...chart },
    ),
    result.ruleset,
  );
}

interface GoalCandidate extends ChartMetric {
  targetAccuracy: number;
  targetChartRks: number;
}

/** One-chart improvement opportunities for a requested overall RKS, across best-list and Phi slots. */
function goalCandidates(result: RankingResult, targetRanking: number): GoalCandidate[] {
  const gap = (targetRanking - result.rankingScore) * result.divisor;
  if (gap <= 0) return [];
  const slots = SLOTS[result.ruleset];
  const inBest = new Set(result.best.map((chart) => chart.key));
  const phiMin = result.phi.length >= slots.phi ? result.phi.at(-1)!.rks : 0;
  const displaced = inBest.size >= slots.best ? result.cutoff : 0;
  const played = new Set(
    result.charts.map((chart) => `${canonicalSongId(chart.songId)}:${chart.levelIndex}`),
  );
  const pool = result.charts.concat(
    catalogSongs.flatMap((song) =>
      song.constants.flatMap((constant, levelIndex) =>
        constant === null || played.has(`${song.id}:${levelIndex}`)
          ? []
          : [blankChart(song, levelIndex, constant)],
      ),
    ),
  );
  return pool
    .flatMap((chart) => {
      if (chart.phi) return []; // already AP'd at its constant: nothing left to gain
      // Cheapest path: enter (or lift within) the best list.
      const base = inBest.has(chart.key) ? chart.rks : displaced;
      const needed = base + gap;
      const accuracy = accuracyForRks(needed, chart.constant);
      if (accuracy !== undefined && accuracy < 100 && accuracy > chart.accuracy) {
        return [{ ...chart, targetAccuracy: accuracy, targetChartRks: needed }];
      }
      // AP: locks in the constant and, past the weakest Phi chart, claims a Phi slot too.
      const apDelta = Math.max(0, chart.constant - base) + Math.max(0, chart.constant - phiMin);
      return result.rankingScore + apDelta / result.divisor >= targetRanking
        ? [{ ...chart, targetAccuracy: 100, targetChartRks: chart.constant }]
        : [];
    })
    .sort(
      (a, b) =>
        Number(b.accuracy > 0) - Number(a.accuracy > 0) ||
        a.targetAccuracy - b.targetAccuracy ||
        order(a, b),
    );
}

/** How far above the hardest chart you've played the model extrapolates, in accuracy % lost per constant level. */
const DROP_PER_LEVEL = 4;

/**
 * Estimates the accuracy a player typically gets at a chart constant, from their own records: a Gaussian-weighted
 * average of nearby records inside the range they've played, falling off steeply past their hardest chart
 * (nobody's scores above their level are known, so be conservative). Undefined with too few records to judge.
 */
function skillModel(charts: readonly ChartMetric[]): (constant: number) => number | undefined {
  const points = charts.filter((chart) => chart.accuracy > 0);
  if (points.length < 5) return () => undefined;
  const constants = points.map((point) => point.constant);
  const hardest = Math.max(...constants);
  const easiest = Math.min(...constants);
  const nearby = (constant: number) => {
    let weights = 0,
      sum = 0;
    for (const point of points) {
      const weight = Math.exp(-(((point.constant - constant) / 0.9) ** 2));
      weights += weight;
      sum += weight * point.accuracy;
    }
    return sum / weights;
  };
  return (constant) => {
    if (constant > hardest)
      return Math.max(0, nearby(hardest) - DROP_PER_LEVEL * (constant - hardest));
    if (constant < easiest) return Math.min(100, nearby(easiest) + (easiest - constant));
    return nearby(constant);
  };
}

export interface TargetSuggestion extends GoalCandidate {
  /** Accuracy the player would likely get (their current accuracy if already higher), if the model has enough data. */
  expectedAccuracy?: number;
  /** "likely": expected ≥ needed. "stretch": needs up to STRETCH points more than expected. */
  reach: "likely" | "stretch";
  isNew: boolean;
}

const STRETCH = 1.5;

/**
 * Realistic one-chart ways to reach a target RKS: goal candidates the player's skill model says they can plausibly hit.
 * Improvements to played charts come first, then new charts, each most achievable first. A never-played song is offered once, at the difficulty whose constant is nearest their RKS.
 */
export function targetSuggestions(
  result: RankingResult,
  targetRanking: number,
  { limit = 12, maxNew = 4 } = {},
): TargetSuggestion[] {
  const predict = skillModel(result.charts);
  const played = new Set(result.charts.map((chart) => chart.key));
  const playedSongs = new Set(result.charts.map((chart) => canonicalSongId(chart.songId)));
  const rated = goalCandidates(result, targetRanking).flatMap(
    (candidate): (TargetSuggestion & { margin: number })[] => {
      const isNew = !played.has(candidate.key);
      const predicted = predict(candidate.constant);
      const expectedAccuracy =
        predicted === undefined ? undefined : Math.max(predicted, isNew ? 0 : candidate.accuracy);
      // Without a model, rank by how big a jump is needed instead.
      const margin =
        expectedAccuracy === undefined
          ? -(candidate.targetAccuracy - candidate.accuracy) / 100
          : expectedAccuracy - candidate.targetAccuracy;
      if (expectedAccuracy !== undefined && margin < -STRETCH) return [];
      return [
        {
          ...candidate,
          expectedAccuracy,
          reach: margin >= 0 || expectedAccuracy === undefined ? "likely" : "stretch",
          isNew,
          margin,
        },
      ];
    },
  );
  const nearestNew = new Map<string, TargetSuggestion>();
  for (const suggestion of rated) {
    const song = canonicalSongId(suggestion.songId);
    if (playedSongs.has(song)) continue;
    const kept = nearestNew.get(song);
    if (
      !kept ||
      Math.abs(suggestion.constant - result.rankingScore) <
        Math.abs(kept.constant - result.rankingScore)
    )
      nearestNew.set(song, suggestion);
  }
  let newCount = 0;
  return (
    rated
      .filter(
        (suggestion) =>
          playedSongs.has(canonicalSongId(suggestion.songId)) ||
          nearestNew.get(canonicalSongId(suggestion.songId)) === suggestion,
      )
      // Improvements to charts already played (stretches included) come before new charts.
      .sort(
        (a, b) =>
          Number(a.isNew) - Number(b.isNew) ||
          b.margin - a.margin ||
          a.targetAccuracy - b.targetAccuracy ||
          order(a, b),
      )
      .filter((suggestion) => !suggestion.isNew || newCount++ < maxNew)
      .slice(0, limit)
      .map(({ margin: _margin, ...suggestion }) => suggestion)
  );
}
