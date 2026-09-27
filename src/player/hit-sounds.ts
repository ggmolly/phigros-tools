import type { NoteType } from "./chart";

const SOUNDS = { 1: "hit-tap", 2: "hit-drag", 3: "hit-tap", 4: "hit-flick" } as const;
const SHARE = 0.65; // here i took 65% (of the music's volume) because we can still here it and i didn't wanted to add a volume control for it

// Opus is ~10× smaller and starts sample-accurately (unlike MP3's encoder delay); Safari before 18.4 can't decode it, so those get the WAVs.
const FORMAT =
  typeof Audio !== "undefined" && new Audio().canPlayType('audio/ogg; codecs="opus"')
    ? "opus"
    : "wav";

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
    const buffer = this.audio?.buffers.get(SOUNDS[type]);
    if (!this.enabled || !this.audio || !buffer) return;
    const source = this.audio.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audio.gain);
    source.start();
  }
}
