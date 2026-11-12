import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { canonicalSongId, catalogSongs } from "../catalog";
import { useFormat, useT } from "../i18n";
import { calculateRanking, type RankingResult } from "../metrics";
import { countLevels } from "../modules";
import { useSave } from "../save-context";
import type { Credential, SnapshotV1 } from "../store";
import { Arrow } from "./arrow";
import { ImportOptions } from "./import";
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
  const t = useT();
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
      aria-label={t.menu.label}
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
            ? t.tabs.charts
            : key === "import"
              ? t.menu.import
              : (player!.credential.nickname ?? key);
        const sub =
          key === "charts"
            ? t.menu.songs(catalogSongs.length)
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
                <MenuHead kicker={sub} title={t.tabs.charts} />
                <div className="menu-strip">
                  <p className="menu-text">{t.menu.chartsText}</p>
                  <Link to="/charts" className="btn menu-play">
                    {t.menu.browse} <Arrow />
                  </Link>
                </div>
              </>
            ) : key === "import" ? (
              <>
                <MenuHead
                  kicker={players.length ? t.menu.anotherAccount : t.menu.yourProgress}
                  title={players.length ? t.menu.importSave : t.menu.mySave}
                />
                <div className="menu-strip">
                  <div className="menu-import">
                    <ImportOptions />
                  </div>
                  <p className="menu-text">{t.ppp.pitch}</p>
                  <Link to="/phigrospp" className="btn menu-play">
                    {t.ppp.get} <Arrow />
                  </Link>
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
  const { openSnapshot, openSignIn, credentials } = useSave();
  const t = useT();
  const format = useFormat();
  const songs = latest?.document.songs ?? [];
  const counts = countLevels(songs);
  // TapTap's cloud is gone: its logins open the copy this browser kept, to send it to Phigros++
  if (credential.token)
    return (
      <>
        <MenuHead kicker={t.menu.welcomeBack} title={credential.nickname ?? credential.playerId} />
        <div className="menu-strip">
          <p className="menu-text">
            {latest ? t.ppp.taptapCard(format.date(latest.capturedAt)) : t.ppp.taptapCardNone}
          </p>
          <div className="menu-actions">
            {!credentials.some((c) => c.signer) && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => openSignIn.current?.()}
              >
                {t.ppp.signInTitle}
              </button>
            )}
            {latest && (
              <button
                type="button"
                className="btn menu-play"
                onClick={() => void openSnapshot(latest)}
              >
                {t.ppp.openSave} <Arrow />
              </button>
            )}
          </div>
        </div>
      </>
    );
  return (
    <>
      <MenuHead
        kicker={`${t.menu.welcomeBack}${latest ? ` · ${t.menu.lastSync(format.date(latest.capturedAt))}` : ""}`}
        title={credential.nickname ?? credential.playerId}
      />
      <div className="menu-strip">
        {ranking ? (
          <div className="stat-row">
            <Stat label="RKS" value={ranking.rankingScore.toFixed(2)} />
            <Stat
              label={t.menu.played}
              value={songs.reduce((sum, song) => sum + song.levels.filter(Boolean).length, 0)}
            />
            <Stat
              label={t.menu.fullCombo}
              value={counts.reduce((sum, count) => sum + count.fc, 0)}
            />
            <Stat label="Phi" value={counts.reduce((sum, count) => sum + count.phi, 0)} />
          </div>
        ) : (
          <p className="menu-text">{t.menu.syncPrompt}</p>
        )}
      </div>
    </>
  );
}
