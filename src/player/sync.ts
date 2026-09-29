/** Envelope frames per second: 5 ms steps, finer than any judgement window. */
const FPS = 200;
/** How far either way the song may be shifted, in seconds. */
const RANGE = 10;

/**
 * Finds the shift (in seconds) that lines a song file up with a chart's hits: the song time
 * of chart time t is t + shift. Scores every candidate by how sharply the audio rises at each
 * note, and returns undefined when no shift stands out from the rest.
 */
export function findShift(song: AudioBuffer, hits: number[]): number | undefined {
  const channels = Array.from({ length: song.numberOfChannels }, (_, i) => song.getChannelData(i));
  const hop = Math.round(song.sampleRate / FPS);
  const fps = song.sampleRate / hop;
  const n = Math.floor(song.length / hop);

  // log energy per frame of the first difference: a crude high-pass that favours percussion
  const energy = new Float32Array(n);
  let prev = 0;
  for (let f = 0; f < n; f++) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      let x = 0;
      for (const data of channels) x += data[i]!;
      const d = x - prev;
      prev = x;
      sum += d * d;
    }
    energy[f] = Math.log(1e-6 + sum / hop);
  }
  // onsets: rises in energy that stand out from the last half second of rises
  const flux = new Float32Array(n);
  const window = Math.round(fps / 2);
  let recent = 0;
  for (let f = 1; f < n; f++) {
    const rise = Math.max(0, energy[f]! - energy[f - 1]!);
    recent += rise - (f > window ? Math.max(0, energy[f - window]! - energy[f - window - 1]!) : 0);
    flux[f] = Math.max(0, rise - recent / Math.min(f, window));
  }

  const at = (t: number) => {
    const i = Math.floor(t * fps);
    return i < 0 || i + 1 >= n ? 0 : Math.max(flux[i]!, flux[i + 1]!);
  };
  const scores: { shift: number; score: number }[] = [];
  for (let ms = -RANGE * 1000; ms <= RANGE * 1000; ms++) {
    const shift = ms / 1000;
    let score = 0;
    for (const hit of hits) score += at(hit + shift);
    scores.push({ shift, score });
  }
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  const sorted = scores.map((s) => s.score).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  // a real match scores several times a typical shift; a song that isn't this chart's doesn't
  return best.score > median * 3 ? best.shift : undefined;
}
