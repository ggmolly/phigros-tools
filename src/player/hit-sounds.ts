import { random } from "../modifiers";
import type { NoteType } from "./chart";

const SOUNDS = { 1: "hit-tap", 2: "hit-drag", 3: "hit-tap", 4: "hit-flick" } as const;
const SHARE = 0.65; // here i took 65% (of the music's volume) because we can still here it and i didn't wanted to add a volume control for it

// Opus is ~10× smaller and starts sample-accurately (unlike MP3's encoder delay); Safari before 18.4 can't decode it, so those get the WAVs.
const FORMAT =
  typeof Audio !== "undefined" && new Audio().canPlayType('audio/ogg; codecs="opus"')
    ? "opus"
    : "wav";

// Nightcore's drums, the samples Phigros++ makes in the game (mod/mods/modifiers.lua): how long each lasts and its
// sample at t seconds, from white noise through a high-pass (h) for the hat and the clap
const DRUM_RATE = 44100;
const DRUMS: Record<string, [number, number, (t: number, h: number) => number]> = {
  kick: [
    0.25,
    0,
    (t) =>
      0.9 *
      Math.sin(2 * Math.PI * (45 * t + 3.6 * (1 - Math.exp(-t / 0.03)))) *
      Math.exp(-t / 0.07),
  ],
  hat: [0.05, 1, (t, h) => 0.3 * h * Math.exp(-t / 0.01)],
  clap: [
    0.2,
    2,
    (t, h) =>
      0.5 * h * (t < 0.022 ? Math.exp(-(t % 0.011) / 0.004) : Math.exp(-(t - 0.022) / 0.045)),
  ],
};
const BEAT = ["kick", "hat", "clap", "hat"] as const; // a half beat each

export class HitSounds {
  enabled = true;
  private volume = 1;
  private audio?: { ctx: AudioContext; gain: GainNode; buffers: Map<string, AudioBuffer> };

  start() {
    if (this.audio) return void this.audio.ctx.resume();
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = SHARE * this.volume;
    gain.connect(ctx.destination);
    const buffers = new Map<string, AudioBuffer>();
    this.audio = { ctx, gain, buffers };
    for (const name of new Set(Object.values(SOUNDS)))
      void fetch(`/player/${name}.${FORMAT}`)
        .then((res) => res.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => buffers.set(name, buffer));
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.audio) this.audio.gain.gain.value = SHARE * volume;
  }

  close() {
    void this.audio?.ctx.close();
    this.audio = undefined;
  }

  play(type: NoteType) {
    if (this.enabled) this.emit(this.audio?.buffers.get(SOUNDS[type]));
  }

  /** Nightcore's drum on the song's index-th half beat, whatever the hit sounds' switch says. */
  drum(index: number) {
    if (!this.audio) return;
    const name = BEAT[index % 4]!;
    if (!this.audio.buffers.has(name)) {
      const [seconds, seed, sample] = DRUMS[name]!;
      const buffer = this.audio.ctx.createBuffer(1, seconds * DRUM_RATE, DRUM_RATE);
      const noise = random(seed);
      let last = 0;
      buffer.getChannelData(0).forEach((_, i, samples) => {
        const white = noise() / 2 ** 31 - 1;
        samples[i] = sample(i / DRUM_RATE, (white - last) / 2);
        last = white;
      });
      this.audio.buffers.set(name, buffer);
    }
    this.emit(this.audio.buffers.get(name));
  }

  private emit(buffer?: AudioBuffer) {
    if (!this.audio || !buffer) return;
    const source = this.audio.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audio.gain);
    source.start();
  }
}
