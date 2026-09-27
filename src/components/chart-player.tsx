import { useEffect, useRef, useState } from "react";
import { type Chart, countUpTo } from "../player/chart";
import { HitSounds } from "../player/hit-sounds";
import { type Art, drawHud, drawScene, loadArt } from "../player/render";
import { Slider, Switch } from "./primitives";

const SPEEDS = [0.1, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const VOLUME_KEY = "chart-player-volume"; // for our localStorage thing

function savedVolume() {
  try {
    const saved = localStorage.getItem(VOLUME_KEY);
    const volume = Number(saved);
    return saved !== null && volume >= 0 && volume <= 1 ? volume : 1;
  } catch {
    return 1;
  }
}

/** m:ss, from 0 */
function clockTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ChartPlayer({
  chart,
  background,
  title,
  level,
  startAt = 0,
}: {
  chart: Chart;
  background: string;
  title: string;
  level: string;
  /** Where the chart opens, in seconds (links to a moment use ?t=). */
  startAt?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  const scrubBox = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const clock = useRef({ base: 0, wall: 0, playing: false, rate: 1 });
  const audio = useRef<HTMLAudioElement>(null);
  const [volume, setVolume] = useState(savedVolume);
  const [hitSounds] = useState(() => {
    const sounds = new HitSounds();
    sounds.setVolume(volume);
    return sounds;
  });
  const lastT = useRef(0);
  const [art, setArt] = useState<Art>();
  const [playing, setPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [songName, setSongName] = useState<string>();
  const [hitSoundsOn, setHitSoundsOn] = useState(true);
  const [copied, setCopied] = useState(false);
  const duration = Math.max(chart.duration, audioDuration - chart.offset);

  useEffect(() => {
    void loadArt().then(setArt);
  }, []);

  useEffect(
    () => () => {
      audio.current?.pause();
      hitSounds.close();
    },
    [hitSounds],
  );

  const now = () => {
    if (audio.current) return audio.current.currentTime - chart.offset;
    const c = clock.current;
    return c.playing ? c.base + ((performance.now() - c.wall) / 1000) * c.rate : c.base;
  };
  const seek = (t: number, play: boolean) => {
    clock.current = { ...clock.current, base: t, wall: performance.now(), playing: play };
    const song = audio.current;
    if (song) {
      song.currentTime = Math.max(0, t + chart.offset);
      if (play) void song.play();
      else song.pause();
    }
    setPlaying(play);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: now/seek only read refs; restart the loop per chart.
  useEffect(() => {
    seek(startAt, false);
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = canvas.current;
      const ctx = el?.getContext("2d");
      if (!el || !ctx || !art) return;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(el.clientWidth * dpr);
      const H = Math.round(el.clientHeight * dpr);
      if (el.width !== W || el.height !== H) Object.assign(el, { width: W, height: H });
      let t = now();
      if (t > duration) {
        t = duration;
        seek(t, false);
      }
      // notes passed since the last frame get their hit sound, unless that jump was a seek
      const prev = lastT.current;
      lastT.current = t;
      if (clock.current.playing && t > prev && t - prev < 0.25)
        for (
          let i = countUpTo(chart.hits, prev, (hit) => hit.sec);
          i < chart.hits.length && chart.hits[i]!.sec <= t;
          i++
        )
          hitSounds.play(chart.hits[i]!.type);
      drawScene(ctx, art, chart, t, W, H);
      drawHud(ctx, chart, t, duration, W, H, title, level);
      // the seek bar and clock follow playback without re-rendering React every frame
      if (scrub.current && document.activeElement !== scrub.current)
        scrub.current.value = String(t);
      const start = Math.min(0, -chart.offset);
      scrubBox.current?.style.setProperty("--p", String((t - start) / (duration - start)));
      if (elapsed.current) elapsed.current.textContent = clockTime(t);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [chart, duration, title, level, art, hitSounds, startAt]);

  const toggle = () => {
    hitSounds.start();
    const t = now();
    seek(t >= duration ? 0 : t, !playing);
  };

  const changeRate = (speed: number) => {
    const next = Math.round(Math.min(2, Math.max(0.1, speed)) * 100) / 100;
    clock.current = { ...clock.current, base: now(), wall: performance.now(), rate: next };
    if (audio.current) audio.current.playbackRate = next;
    setRate(next);
  };

  const changeVolume = (next: number) => {
    setVolume(next);
    if (audio.current) audio.current.volume = next;
    hitSounds.setVolume(next);
    try {
      localStorage.setItem(VOLUME_KEY, String(next));
    } catch {}
  };

  /** Copies a link that opens the chart at the current second. */
  const copyLink = () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("t", String(Math.max(0, Math.floor(now()))));
    void navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  const loadSong = (file: File | undefined) => {
    if (!file) return;
    const at = now(); // keep the position (e.g. a ?t= link) when the song takes over the clock
    const previous = audio.current;
    if (previous) {
      previous.pause();
      URL.revokeObjectURL(previous.src);
    }
    const song = new Audio(URL.createObjectURL(file));
    song.volume = volume;
    song.defaultPlaybackRate = rate;
    song.playbackRate = rate;
    song.onloadedmetadata = () => setAudioDuration(song.duration);
    song.onended = () => setPlaying(false);
    audio.current = song;
    setSongName(file.name);
    seek(at, false);
  };

  return (
    <div className="chart-player">
      <div className="chart-player-stage">
        <img src={background} alt="" />
        <canvas ref={canvas} onClick={toggle} />
      </div>
      <div className="chart-player-transport">
        <button type="button" className="btn chart-player-play" onClick={toggle}>
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="num chart-player-time chart-player-share"
          title="Copy a link to this moment"
          onClick={copyLink}
        >
          <span ref={elapsed}>0:00</span>
          <span className="chart-player-copied" role="status">
            {copied ? "Link copied" : ""}
          </span>
        </button>
        <Slider
          className="slider-thin"
          min={Math.min(0, -chart.offset)}
          max={duration}
          step="any"
          label="Position"
          boxRef={scrubBox}
          inputRef={scrub}
          onChange={(t) => seek(t, playing)}
        />
        <span className="num chart-player-time">{clockTime(duration)}</span>
      </div>
      <section className="panel chart-player-settings" aria-label="Playback settings">
        <div className="player-setting">
          <div className="player-setting-head">
            <span>Speed</span>
            <span className="num">{rate.toFixed(2)}×</span>
          </div>
          <div className="stepper">
            <button
              type="button"
              className="step"
              aria-label="Slower"
              disabled={rate <= SPEEDS[0]!}
              onClick={() => changeRate(SPEEDS.findLast((speed) => speed < rate) ?? rate)}
            >
              −
            </button>
            <Slider
              value={rate}
              min={0.1}
              max={2}
              step={0.05}
              label="Speed"
              onChange={changeRate}
            />
            <button
              type="button"
              className="step"
              aria-label="Faster"
              disabled={rate >= SPEEDS.at(-1)!}
              onClick={() => changeRate(SPEEDS.find((speed) => speed > rate) ?? rate)}
            >
              +
            </button>
          </div>
        </div>
        <div className="player-setting">
          <div className="player-setting-head">
            <span>Music Volume</span>
            <span className="num">{Math.round(volume * 100)}%</span>
          </div>
          <div className="slider-caps">
            <Slider
              value={volume}
              min={0}
              max={1}
              step={0.01}
              label="Music volume"
              onChange={changeVolume}
            />
          </div>
        </div>
        <div className="player-setting">
          <div className="player-setting-head">
            <span>Hitsound</span>
            <span className="num">{hitSoundsOn ? "On" : "Off"}</span>
          </div>
          <Switch
            checked={hitSoundsOn}
            label="Hitsound"
            onChange={(on) => {
              hitSounds.enabled = on;
              setHitSoundsOn(on);
            }}
          />
        </div>
        <div className="player-setting">
          <div className="player-setting-head">
            <span>Song</span>
          </div>
          <div className="player-song">
            <button type="button" className="btn btn-ghost" onClick={() => picker.current?.click()}>
              {songName ? "Change" : "Load Song File"}
            </button>
            {songName && <span className="meta">{songName}</span>}
          </div>
          <input
            ref={picker}
            type="file"
            accept="audio/*"
            hidden
            onChange={(event) => loadSong(event.currentTarget.files?.[0])}
          />
        </div>
      </section>
    </div>
  );
}
