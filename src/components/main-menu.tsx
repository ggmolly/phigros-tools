import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { canonicalSongId, catalogSongs } from "../catalog";
import { calculateRanking, type RankingResult } from "../metrics";
import { countLevels } from "../modules";
import { useSave } from "../save-context";
import type { Credential, SnapshotV1 } from "../store";
import { Arrow, SyncIcon } from "./arrow";
import { ImportGuide, ImportOptions } from "./import";
import { Stat } from "./primitives";

function MenuArt({ song }: { song?: string }) {
  return (
    <span className="menu-art" aria-hidden="true">
      {song && <img key={song} src={`/covers/${song}.avif`} alt="" />}
    </span>
  );
}

/**
 * The no-save state, laid out like the game's main menu: a carousel of Charts, one entry per remembered player
 * (most recently synced first) and Import. Only the open entry is expanded; the others are retracted to slanted
 * slivers. On phones the same entries stack vertically.
 */
export function MainMenu() {
  const { credentials, snapshots, setChartKey } = useSave();
  const [randomSongs, setRandomSongs] = useState<string[]>([]);
  // Picked after hydration so the server and client render the same markup.
  useEffect(() => {
    const pick = () => catalogSongs[Math.floor(Math.random() * catalogSongs.length)]!.id;
    setRandomSongs([pick(), pick()]);
  }, []);
  // snapshots are newest first, so a player's first match is their latest.
  const players = credentials
    .map((credential) => {
      const latest = snapshots.find((s) => s.playerId === credential.playerId);
      return { credential, latest, ranking: latest && calculateRanking(latest.document) };
    })
    .sort((a, b) => (b.latest?.capturedAt ?? "").localeCompare(a.latest?.capturedAt ?? ""));
  const keys = ["charts", ...players.map((p) => p.credential.playerId), "import"];
  const [picked, setPicked] = useState<string>();
  const open =
    picked && keys.includes(picked) ? picked : (players[0]?.credential.playerId ?? "import");
  const userPicked = useRef(false);
  const openEntry = useRef<HTMLElement>(null);

  const art = (key: string) => {
    if (key === "charts") return randomSongs[0];
    const best = players.find((p) => p.credential.playerId === key)?.ranking?.best[0];
    return best ? canonicalSongId(best.songId) : randomSongs[1];
  };
  const openArt = art(open);
  // The fog takes the open entry's colours, like it does for the selected chart once a save is open.
  useEffect(() => {
    if (openArt) setChartKey(`${openArt}:`);
  }, [openArt, setChartKey]);

  function reveal() {
    openEntry.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
  function choose(key: string) {
    userPicked.current = true;
    setPicked(key);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the open entry changes; reveal isn't wrapped in useCallback (the React Compiler handles memoisation).
  useEffect(() => {
    if (!userPicked.current) return;
    openEntry.current?.focus({ preventScroll: true });
    requestAnimationFrame(reveal); // the widening transition ends with another reveal()
  }, [open]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset's default styling would need a reset; role="group" labels the carousel.
    <div
      className="menu"
      role="group"
      aria-label="Main menu"
      onKeyDown={(e) => {
        const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        const next = step && keys[keys.indexOf(open) + step];
        if (next && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          choose(next);
        }
      }}
    >
      {keys.map((key) => {
        const player = players.find((p) => p.credential.playerId === key);
        const label =
          key === "charts"
            ? "Charts"
            : key === "import"
              ? "Import"
              : (player!.credential.nickname ?? key);
        const sub =
          key === "charts"
            ? `${catalogSongs.length} songs`
            : player?.ranking && `RKS ${player.ranking.rankingScore.toFixed(2)}`;
        if (key !== open)
          return (
            <section key={key} className="menu-entry">
              <MenuArt song={art(key)} />
              <button type="button" className="menu-sliver" onClick={() => choose(key)}>
                <span className="menu-sliver-text">
                  <span className="menu-sliver-label">{label}</span>
                  {sub && <span className="menu-sliver-sub">{sub}</span>}
                </span>
              </button>
            </section>
          );
        return (
          <section
            key={key}
            ref={openEntry}
            tabIndex={-1}
            className="menu-entry is-open"
            aria-labelledby="empty-heading"
            onTransitionEnd={(e) => {
              if (e.target === e.currentTarget && e.propertyName === "flex-basis") reveal();
            }}
          >
            <MenuArt song={art(key)} />
            {key === "charts" ? (
              <>
                <MenuHead kicker={sub} title="Charts" />
                <div className="menu-strip">
                  <p className="menu-text">
                    Every chart’s difficulty constant, charters and note stats.
                  </p>
                  <Link to="/charts" className="btn menu-play">
                    Browse <Arrow />
                  </Link>
                </div>
              </>
            ) : key === "import" ? (
              <>
                <MenuHead
                  kicker={players.length ? "Another account or file" : "Your Progress"}
                  title={players.length ? "Import Save" : "My Save"}
                />
                <div className="menu-strip">
                  <div className="menu-import">
                    <ImportOptions />
                  </div>
                  <ImportGuide className="btn menu-play" />
                </div>
              </>
            ) : (
              <PlayerCard player={player!} />
            )}
          </section>
        );
      })}
    </div>
  );
}

function MenuHead({ kicker, title }: { kicker?: string; title: string }) {
  return (
    <div className="menu-head">
      <p className="menu-kicker">{kicker}</p>
      <h1 id="empty-heading" className="menu-title">
        {title}
      </h1>
    </div>
  );
}

function PlayerCard({
  player: { credential, latest, ranking },
}: {
  player: { credential: Credential; latest?: SnapshotV1; ranking?: RankingResult };
}) {
  const { sync, busy, syncPlayer, syncLabel } = useSave();
  const songs = latest?.document.songs ?? [];
  const counts = countLevels(songs);
  const syncing = sync && sync.playerId === credential.playerId ? sync.state : undefined;
  return (
    <>
      <MenuHead
        kicker={`Welcome back${latest ? ` · last sync ${new Date(latest.capturedAt).toLocaleDateString()}` : ""}`}
        title={credential.nickname ?? credential.playerId}
      />
      <div className="menu-strip">
        {ranking ? (
          <div className="stat-row">
            <Stat label="RKS" value={ranking.rankingScore.toFixed(2)} />
            <Stat
              label="Played"
              value={songs.reduce((sum, song) => sum + song.levels.filter(Boolean).length, 0)}
            />
            <Stat label="Full Combo" value={counts.reduce((sum, count) => sum + count.fc, 0)} />
            <Stat label="Phi" value={counts.reduce((sum, count) => sum + count.phi, 0)} />
          </div>
        ) : (
          <p className="menu-text">Sync to fetch your newest cloud save.</p>
        )}
        <button
          type="button"
          className={`btn menu-play${syncing ? ` sync-${syncing}` : ""}`}
          disabled={busy}
          onClick={() => void syncPlayer(credential)}
        >
          <SyncIcon spinning={syncing === "syncing"} />
          <span className="sync-label">{syncLabel(credential.playerId, "Sync")}</span>
        </button>
      </div>
    </>
  );
}
