import { useEffect, useRef, useState } from "react";
import { catalogSong } from "../catalog";
import { useT } from "../i18n";
import { createJudge } from "../judge";
import { modChart } from "../modifiers";
import { LEVELS, type LevelName } from "../modules";
import { decodeReplay, type ReplayFrame } from "../pigeon";
import { type Chart, parseChart, type RawChart } from "../player/chart";
import { decodePhc } from "../player/phc";
import type { Play } from "../player/render";
import type { PlayerName } from "../plays";
import { drawFingers, toPlay } from "../replay-play";
import type { RoomChart, RoomView } from "../rooms";
import { Arrow } from "./arrow";
import { ChartPlayer } from "./chart-player";
import { PlayerTag } from "./plays";

const RECONNECT = 2000; // ms before a dropped connection is made again

/** Hears a player's frames (`data`, a replay of those since the last ones, in base64). Returns what stops it. */
export type Frames = (listener: (player: string, data: string) => void) => () => void;

/**
 * Watching a room from the browser (server/rooms.ts): a socket that never signs in, gets the room as its players do
 * (without their chat) and the frames of the player it follows. `room` is undefined until watching, null once closed.
 */
export function useRoomWatch(id: string) {
  const [room, setRoom] = useState<RoomView | null>();
  const [error, setError] = useState<string>();
  const socket = useRef<WebSocket>(undefined);
  const listeners = useRef(new Set<(player: string, data: string) => void>());
  // what a dropped connection takes up again: the password, who's followed and how many of their parts came
  const kept = useRef({ password: "", player: "", parts: 0, over: true });
  const [connect] = useState(() => () => {
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/room`);
    const { player, parts } = kept.current;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "watch", room: id, password: kept.current.password }));
      if (player) ws.send(JSON.stringify({ t: "follow", player, from: parts }));
    };
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.t === "room") setRoom(m.room);
      else if (m.t === "frames" && m.player === kept.current.player) {
        kept.current.parts++;
        for (const listener of listeners.current) listener(m.player, m.data);
      } else if (m.t === "error") {
        kept.current.over = true;
        setError(m.code);
        ws.close();
      }
    };
    ws.onclose = () => {
      if (socket.current === ws && !kept.current.over) setTimeout(connect, RECONNECT);
    };
    socket.current = ws;
  });
  useEffect(
    () => () => {
      kept.current.over = true;
      socket.current?.close();
    },
    [],
  );
  const watch = (password: string) => {
    kept.current = { password, player: "", parts: 0, over: false };
    socket.current?.close();
    setError(undefined);
    connect();
  };
  const [follow] = useState(() => (player: string) => {
    Object.assign(kept.current, { player, parts: 0 });
    socket.current?.send(JSON.stringify({ t: "follow", player, from: 0 }));
  });
  const [frames] = useState(() => {
    const frames: Frames = (listener) => {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    };
    return frames;
  });
  return { room, error, watch, follow, frames };
}

/** Asks a room's password, then watches it. */
export function WatchDialog({
  open,
  error,
  onWatch,
  onClose,
}: {
  open: boolean;
  error?: string;
  onWatch: (password: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <dialog ref={dialog} closedby="any" aria-labelledby="watch-heading" onClose={onClose}>
      <form method="dialog" className="dialog-head">
        <h2 id="watch-heading">{t.rooms.watchTitle}</h2>
        {/* biome-ignore lint/a11y/useButtonType: the default submit type closes the method="dialog" form. */}
        <button className="dialog-close" aria-label={t.ppp.close}>
          ×
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onWatch(String(new FormData(e.currentTarget).get("password") ?? ""));
        }}
      >
        <p className="meta">{t.rooms.watchText}</p>
        <label htmlFor="watch-password" className="field-label">
          {t.rooms.password}
        </label>
        <input
          id="watch-password"
          name="password"
          type="password"
          className="field"
          required
          maxLength={64}
          autoComplete="off"
        />
        <p role="status" className="negative" hidden={!error}>
          {error === "password" ? t.rooms.wrongPassword : error === "full" ? t.rooms.tooMany : ""}
        </p>
        <div className="dialog-actions">
          <button type="submit" className="btn">
            {t.rooms.watch} <Arrow />
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface Stream {
  parsed: Chart;
  frames: ReplayFrame[];
  overlay: ReturnType<typeof drawFingers>;
  live: () => number;
}

/**
 * A player's play in a room, live: their frames are judged as they come on the chart as they play it (its modifiers
 * and the seed Random shuffled it with come with the frames), and drawn a moment behind them.
 */
export function RoomWatch({
  chart,
  player,
  frames,
}: {
  chart: RoomChart;
  player: PlayerName;
  frames: Frames;
}) {
  const t = useT();
  const song = catalogSong(chart.song);
  const [stream, setStream] = useState<Stream>();
  const [play, setPlay] = useState<Play & { hits: Chart["hits"] }>();
  const [error, setError] = useState<string>();

  // frames heard before the chart loaded wait for it
  useEffect(() => {
    let raw: RawChart | undefined;
    let judging: { raw: RawChart; judge: ReturnType<typeof createJudge> } | undefined;
    let current: Stream | undefined;
    const waiting: string[] = [];
    const take = (data: string) => {
      const { header, frames: list } = decodeReplay(
        Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
      );
      if (!judging || !current) {
        const played = modChart(raw!, header.mods, header.seed, header.mirror === 1);
        const all: ReplayFrame[] = [];
        judging = { raw: played, judge: createJudge(played, header) };
        current = {
          parsed: parseChart(played),
          frames: all,
          overlay: drawFingers(header, all),
          live: () => all.at(-1)?.t ?? 0,
        };
        setStream(current);
      }
      current.frames.push(...list);
      judging.judge.feed(list);
      setPlay(toPlay(judging.raw, current.parsed, judging.judge.result, header));
    };
    const stop = frames((id, data) => {
      if (id !== player.id) return;
      if (raw) take(data);
      else waiting.push(data);
    });
    fetch(`/chart-data/${encodeURIComponent(chart.song)}/${chart.level}.phc`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        raw = decodePhc(new Uint8Array(data));
        for (const each of waiting.splice(0)) take(each);
      })
      .catch((reason: Error) => setError(t.player.loadError(reason.message)));
    return stop;
  }, [chart.song, chart.level, player.id, frames, t]);

  if (!song) return null;
  const level = chart.level as LevelName;
  const constant = song.constants[LEVELS.indexOf(level)] ?? 0;
  return (
    <section className="panel room-watch">
      <div className="panel-head">
        <h2 className="panel-title">
          <PlayerTag player={player} />
        </h2>
        <span className="status status-verified">{t.rooms.live}</span>
      </div>
      {error ? (
        <p className="meta">{error}</p>
      ) : stream ? (
        <ChartPlayer
          chart={stream.parsed}
          background={`/covers/${song.id}.avif`}
          music={`/music/${song.id}.webm`}
          title={song.title}
          level={`${level}  Lv.${Math.floor(constant)}`}
          overlay={stream.overlay}
          play={play}
          live={stream.live}
        />
      ) : (
        <p className="meta">{t.rooms.waitingPlay}</p>
      )}
    </section>
  );
}
