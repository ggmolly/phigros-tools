import { useEffect, useRef, useState } from "react";
import { type Chart, countUpTo } from "../player/chart";
import { HitSounds } from "../player/hit-sounds";
import { type Art, drawHud, drawScene, loadArt } from "../player/render";
import { findShift } from "../player/sync";
import { Slider, Switch } from "./primitives";

const SPEEDS = [0.1, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const VOLUME_KEY = "chart-player-volume"; // for our localStorage thing
/** the offset stepper's nudge, in ms */
const OFFSET_STEP = 5;
/** how long before the first note "First Note" lands, so it can be seen coming */
const FIRST_NOTE_LEAD = 1;

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
  /** the user's offset in ms: positive makes the notes come later against the song */
  const [offset, setOffset] = useState(0);
  const songFile = useRef<File>(undefined);
  const [sync, setSync] = useState<"idle" | "busy" | "failed">("idle");
  /** seconds into the song where chart time 0 falls */
  const lead = chart.offset + offset / 1000;
  const leadRef = useRef(lead); // for the frame loop
  useEffect(() => {
    leadRef.current = lead;
  }, [lead]);
  /** When the last link was copied (0: no note showing); keys the note so each copy replays its animation. */
  const [copied, setCopied] = useState(0);
  const copiedTimer = useRef(0);
  const duration = Math.max(chart.duration, audioDuration - lead);
  const start = Math.min(0, -lead);
  const offsetRange = Math.max(1000, Math.ceil(Math.abs(offset) / 1000) * 1000);

  useEffect(() => {
    void loadArt().then(setArt);
  }, []);

  useEffect(
    () => () => {
      audio.current?.pause();
      hitSounds.close();
      window.clearTimeout(copiedTimer.current);
    },
    [hitSounds],
  );

  const now = () => {
    if (audio.current) return audio.current.currentTime - leadRef.current;
    const c = clock.current;
    return c.playing ? c.base + ((performance.now() - c.wall) / 1000) * c.rate : c.base;
  };
  const seek = (t: number, play: boolean) => {
    clock.current = { ...clock.current, base: t, wall: performance.now(), playing: play };
    const song = audio.current;
    if (song) {
      song.currentTime = Math.max(0, t + leadRef.current);
      if (play) void song.play();
      else song.pause();
    }
    setPlaying(play);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: seek only reads refs; start over per chart.
  useEffect(() => seek(startAt, false), [chart, startAt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: now/seek only read refs; restart the loop per chart.
  useEffect(() => {
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
      scrubBox.current?.style.setProperty("--p", String((t - start) / (duration - start)));
      if (elapsed.current) elapsed.current.textContent = clockTime(t);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [chart, duration, start, title, level, art, hitSounds]);

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

  const jumpToFirstNote = () => {
    const first = chart.hits[0]?.sec ?? 0;
    seek(Math.max(start, first - FIRST_NOTE_LEAD), playing);
  };

  const changeOffset = (ms: number) => {
    setOffset(Math.round(ms));
    setSync("idle");
  };

  const autoSync = async () => {
    const file = songFile.current;
    if (!file) return;
    setSync("busy");
    try {
      const context = new OfflineAudioContext(1, 1, 44100);
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      if (songFile.current !== file) return; // another song was loaded meanwhile
      const shift = findShift(
        decoded,
        chart.hits.map((hit) => hit.sec),
      );
      if (shift === undefined) return setSync("failed");
      setOffset(Math.round((shift - chart.offset) * 1000));
      setSync("idle");
    } catch {
      setSync("failed");
    }
  };

  const changeVolume = (next: number) => {
    setVolume(next);
    if (audio.current) audio.current.volume = next;
    hitSounds.setVolume(next);
    try {
      localStorage.setItem(VOLUME_KEY, String(next));
    } catch {}
  };

  const copyLink = () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("t", String(Math.max(0, Math.floor(now()))));
    // phones get the share sheet; desktop ones (Windows, macOS) are clunkier than a copied link
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      void navigator.share({ title: document.title, url: url.toString() }).catch(() => {});
      return;
    }
    void navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(performance.now());
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(0), 1800); // the note's animation length
    });
  };

  const loadSong = (file: File | undefined) => {
    if (!file) return;
    const at = now();
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
    songFile.current = file;
    setSongName(file.name);
    setSync("idle");
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
        <button type="button" className="btn btn-ghost" onClick={jumpToFirstNote}>
          First Note
        </button>
        <button
          type="button"
          className="num chart-player-time chart-player-share"
          title="Share a link to this moment"
          onClick={copyLink}
        >
          <span ref={elapsed}>0:00</span>
          <span className="chart-player-copied" role="status">
            {copied > 0 && <span key={copied}>Link copied</span>}
          </span>
        </button>
        <Slider
          className="slider-thin"
          min={start}
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
        <div className="player-setting">
          <div className="player-setting-head">
            <span>Offset</span>
            <span className="num">{offset > 0 ? `+${offset}` : offset} ms</span>
          </div>
          <div className="stepper">
            <button
              type="button"
              className="step"
              aria-label="Notes earlier"
              onClick={() => changeOffset(offset - OFFSET_STEP)}
            >
              −
            </button>
            <Slider
              value={offset}
              min={-offsetRange}
              max={offsetRange}
              step={1}
              label="Offset"
              onChange={changeOffset}
            />
            <button
              type="button"
              className="step"
              aria-label="Notes later"
              onClick={() => changeOffset(offset + OFFSET_STEP)}
            >
              +
            </button>
          </div>
          <div className="player-song">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!songName || sync === "busy"}
              onClick={() => void autoSync()}
            >
              {sync === "busy" ? "Syncing…" : "Auto-Sync"}
            </button>
            {offset !== 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => changeOffset(0)}>
                Reset
              </button>
            )}
            <span className="meta" role="status">
              {!songName
                ? "Load a song file to line it up with the chart."
                : sync === "failed"
                  ? "Couldn't match this file to the chart."
                  : ""}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
