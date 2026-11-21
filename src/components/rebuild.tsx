import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type CatalogSong, catalogSong, catalogSongs, searchFold } from "../catalog";
import { blankDocument, parseJsonDocument, type SaveDocumentV1 } from "../document";
import { Rich, useFormat, useT } from "../i18n";
import { calculateRanking, chartRks } from "../metrics";
import { LEVELS, type LevelRecord, type SongRecord } from "../modules";
import { message, useSave } from "../save-context";
import { hasKey, KEYS, lockedChapters, setKey, unlock } from "../unlocks";
import { Arrow } from "./arrow";
import { avatarUrl, Difficulty, DifficultyFilter, Stat, Switch } from "./primitives";

const DRAFT = "rebuild";
const PAGE = 40;
const COLOURS = ["white", "green", "blue", "red", "gold", "rainbow"] as const;

interface Chart {
  song: CatalogSong;
  level: number;
  constant: number;
  fold: string;
}
/** Every chart from the hardest: a player's best ones, which make their RKS, sit near the top of what they play. */
const CHARTS: Chart[] = catalogSongs
  .flatMap((song) => {
    const fold = searchFold(song.title, song.artist, ...(song.romanized ?? []));
    return song.constants.flatMap((constant, level) =>
      constant ? [{ song, level, constant, fold }] : [],
    );
  })
  .sort((a, b) => b.constant - a.constant);

type Typed = { record: LevelRecord; fc: boolean } | null;

/** What a row's fields say: nothing typed is no record, and a full score is a Phi whatever else is typed. */
function typed(scoreText: string, accuracyText: string, fc: boolean): Typed {
  const score = Math.min(1_000_000, Number.parseInt(scoreText, 10));
  const accuracy = Math.min(100, Number.parseFloat(accuracyText.replace(",", ".")));
  if (Number.isNaN(score) && Number.isNaN(accuracy)) return null;
  const phi = score === 1_000_000;
  return { record: { score: score || 0, accuracy: phi ? 100 : accuracy || 0 }, fc: fc || phi };
}

/** One chart's record as the game's result screen shows it: score, accuracy, full combo. */
function ChartRow({
  chart,
  record,
  fc,
  onChange,
}: {
  chart: Chart;
  record?: LevelRecord | null;
  fc: boolean;
  onChange: (value: Typed) => void;
}) {
  const r = useT().rebuild;
  const name = `${chart.song.title} ${LEVELS[chart.level]}`;
  // the fields keep what's typed until it's left, then read as the record they made
  function commit(row: HTMLElement, combo = fc) {
    const [score, accuracy] = row.querySelectorAll("input");
    const value = typed(score!.value, accuracy!.value, combo);
    score!.value = value ? String(value.record.score) : "";
    accuracy!.value = value ? String(value.record.accuracy) : "";
    onChange(value);
  }
  return (
    <li className="rebuild-row">
      <span className="rebuild-song">
        {chart.song.title}
        <span className="meta small">{chart.song.artist}</span>
      </span>
      <span className="rebuild-level">
        <Difficulty level={LEVELS[chart.level]!} />
        <span className="meta num">{chart.constant.toFixed(1)}</span>
      </span>
      <input
        className="field num"
        inputMode="numeric"
        pattern="\d{1,7}"
        maxLength={7}
        placeholder={r.score}
        aria-label={r.scoreOf(name)}
        defaultValue={record?.score}
        onBlur={(e) => commit(e.currentTarget.parentElement!)}
      />
      <input
        className="field num"
        inputMode="decimal"
        pattern="\d{1,3}([.,]\d{1,4})?"
        maxLength={8}
        placeholder="%"
        aria-label={r.accuracyOf(name)}
        defaultValue={record ? Number(record.accuracy.toFixed(4)) : undefined}
        required={!!record}
        onBlur={(e) => commit(e.currentTarget.parentElement!)}
      />
      <button
        type="button"
        className="seg-option"
        aria-pressed={fc}
        aria-label={r.fcOf(name)}
        disabled={!record}
        onClick={(e) => commit(e.currentTarget.parentElement!, !fc)}
      >
        FC
      </button>
      <span className="meta num">
        {record ? chartRks(record.accuracy, chart.constant).toFixed(2) : ""}
      </span>
    </li>
  );
}

/** The keys of one kind the save has, each a checkbox once the list is opened. Collection items have no name a
 * player knows, so they're taken or left together. */
function Keys({
  kind,
  draft,
  onChange,
}: {
  kind: number;
  draft: SaveDocumentV1;
  onChange: (names: string[], on: boolean) => void;
}) {
  const r = useT().rebuild;
  const [open, setOpen] = useState(false);
  const names = Object.keys(KEYS[kind]!);
  const picked = names.filter((name) => hasKey(draft.gameKey, kind, name));
  return (
    <details className="rebuild-keys" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {r.kinds[kind]}
        <span className="meta num">{r.picked(picked.length, names.length)}</span>
      </summary>
      <div className="rebuild-actions">
        <button type="button" className="btn btn-ghost" onClick={() => onChange(names, true)}>
          {r.all}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onChange(names, false)}>
          {r.clear}
        </button>
      </div>
      {open && kind !== 1 && (
        <ul className="rebuild-key-list">
          {names.map((name) => (
            <li key={name}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.includes(name)}
                  onChange={(e) => onChange([name], e.currentTarget.checked)}
                />
                {name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** A save made by hand for a player whose own stays in the game: their records, their profile and what they had
 * unlocked, then a profile to keep it on, which Phigros++ loads it from. */
export function Rebuild() {
  const { credentials, loaded, storageReady, publish } = useSave();
  const t = useT();
  const format = useFormat();
  const r = t.rebuild;
  const [draft, setDraft] = useState(blankDocument);
  // the fields of a row only read the draft when they appear: a draft from elsewhere shows them again
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [typedOnly, setTypedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [phrase, setPhrase] = useState<{ seed: Uint8Array; words: string[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const profile = credentials.find((c) => c.signer);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the browser's storage has been read
  useEffect(() => {
    if (!storageReady) return;
    const kept = localStorage.getItem(DRAFT);
    // a signed-in player goes on from the save of their profile
    const own = loaded?.playerId === profile?.playerId && !loaded?.document.warnings;
    try {
      if (kept) setDraft(parseJsonDocument(kept));
      else if (profile && own) setDraft(loaded!.document);
    } catch {
      // a draft an older phigros.tools kept, which this one no longer reads
      localStorage.removeItem(DRAFT);
    }
    setVersion((v) => v + 1);
    setReady(true);
  }, [storageReady]);
  useEffect(() => {
    if (ready && !done) localStorage.setItem(DRAFT, JSON.stringify(draft));
  }, [draft, ready, done]);

  const songs = new Map(draft.songs.map((song) => [song.songId, song]));
  const ranking = calculateRanking({ songs: draft.songs });
  const fold = searchFold(query);
  const charts = CHARTS.filter(
    (chart) =>
      (level === "" || chart.level === Number(level)) &&
      chart.fold.includes(fold) &&
      (!typedOnly || songs.get(chart.song.id)?.levels[chart.level]),
  );
  const userProfile = draft.profile!;
  const rank = draft.gameProgress.challengeModeRank;

  function setRecord(chart: Chart, value: Typed) {
    setDraft((doc) => {
      const old: SongRecord = doc.songs.find((song) => song.songId === chart.song.id) ?? {
        rawSongId: `${chart.song.id}.0`,
        songId: chart.song.id,
        fc: 0,
        levels: [null, null, null, null],
      };
      const levels = old.levels.with(chart.level, value?.record ?? null) as SongRecord["levels"];
      const fc = value?.fc ? old.fc | (1 << chart.level) : old.fc & ~(1 << chart.level);
      const others = doc.songs.filter((song) => song !== old);
      return { ...doc, songs: levels.some(Boolean) ? [...others, { ...old, fc, levels }] : others };
    });
  }
  const setProfile = (change: Partial<typeof userProfile>) =>
    setDraft((doc) => ({ ...doc, profile: { ...doc.profile!, ...change } }));
  const setRank = (value: number) =>
    setDraft((doc) => ({
      ...doc,
      gameProgress: { ...doc.gameProgress, challengeModeRank: value },
    }));
  function setKeys(kind: number, names: string[], on: boolean) {
    setDraft((doc) => {
      const gameKey = structuredClone(doc.gameKey);
      for (const name of names) setKey(gameKey, kind, name, on);
      return { ...doc, gameKey };
    });
  }
  function reset() {
    if (!confirm(r.resetConfirm)) return;
    setDraft(blankDocument());
    setVersion((v) => v + 1);
    setPhrase(undefined);
  }
  async function submit(form: HTMLFormElement) {
    setError("");
    if (!draft.songs.length) return setError(r.empty);
    // a new profile shows its password first, and is made once the player says it's kept
    if (!profile && !phrase) return setPhrase((await import("../phigrospp")).newPhrase());
    setBusy(true);
    try {
      const name = String(new FormData(form).get("name") ?? "");
      await publish(unlock(draft), profile ? undefined : { name, seed: phrase!.seed });
      localStorage.removeItem(DRAFT);
      setDone(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <section className="panel" role="status">
        <h1 className="panel-title">{profile && !phrase ? r.sent : r.done}</h1>
        {profile && !phrase ? (
          <p className="meta">{r.sentText}</p>
        ) : (
          <ol className="guide-steps">
            {[r.done1, r.done2, r.done3].map((step) => (
              <li key={step}>
                <Rich text={step} />
              </li>
            ))}
          </ol>
        )}
        <div className="rebuild-actions">
          <Link to="/" className="btn">
            {r.open} <Arrow />
          </Link>
          {!(profile && !phrase) && (
            <Link to="/phigrospp" className="btn btn-ghost">
              {t.ppp.get}
            </Link>
          )}
        </div>
      </section>
    );
  return (
    <>
      <section className="panel">
        <h1 className="panel-title">{r.title}</h1>
        <p className="meta rebuild-lead">{r.description}</p>
        {profile && <p className="warning">{r.editing}</p>}
      </section>
      <section className="panel rebuild-records">
        <div className="rebuild-stats">
          <Stat label="RKS" value={ranking.rankingScore.toFixed(2)} />
          <Stat label={r.charts} value={ranking.charts.length} />
          <Stat label={r.best} value={ranking.best.length} total={27} />
          <Stat label={r.phi} value={ranking.phi.length} total={3} />
        </div>
        <h2 className="panel-title">{r.records}</h2>
        <search className="filters">
          <input
            type="search"
            className="field search-field"
            placeholder={r.search}
            aria-label={r.search}
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setShown(PAGE);
            }}
          />
          <DifficultyFilter value={level} onChange={setLevel} />
          <span className="rebuild-switch">
            <Switch checked={typedOnly} label={r.typed} onChange={setTypedOnly} />
            {r.typed}
          </span>
        </search>
        <ul className="rebuild-rows">
          {charts.slice(0, shown).map((chart) => {
            const song = songs.get(chart.song.id);
            return (
              <ChartRow
                key={`${version}:${chart.song.id}:${chart.level}`}
                chart={chart}
                record={song?.levels[chart.level]}
                fc={Boolean(((song?.fc ?? 0) >> chart.level) & 1)}
                onChange={(value) => setRecord(chart, value)}
              />
            );
          })}
        </ul>
        {charts.length > shown && (
          <button type="button" className="btn btn-ghost" onClick={() => setShown(shown + PAGE)}>
            {r.more(Math.min(PAGE, charts.length - shown))}
          </button>
        )}
      </section>
      <section className="panel">
        <h2 className="panel-title">{r.profile}</h2>
        <div className="rebuild-profile">
          <img src={avatarUrl(userProfile.avatar)} alt="" width="64" height="64" />
          <label className="select">
            <span className="select-label">{r.avatar}</span>
            <select
              className="select-field"
              value={userProfile.avatar}
              onChange={(e) => setProfile({ avatar: e.currentTarget.value })}
            >
              <option value="">{r.none}</option>
              {Object.keys(KEYS[3]!).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="select">
            <span className="select-label">{r.background}</span>
            <select
              className="select-field"
              value={userProfile.background}
              onChange={(e) => setProfile({ background: e.currentTarget.value })}
            >
              <option value="">{r.none}</option>
              {/* a save names its background by the song's id */}
              {catalogSongs.map((song) => (
                <option key={song.id} value={`${song.id}.0`}>
                  {song.title}
                </option>
              ))}
              {userProfile.background &&
                !catalogSongs.some((song) => `${song.id}.0` === userProfile.background) && (
                  <option>{userProfile.background}</option>
                )}
            </select>
          </label>
          <label className="select">
            <span className="select-label">{r.challenge}</span>
            <select
              className="select-field"
              value={rank ? Math.floor(rank / 100) : ""}
              onChange={(e) =>
                setRank(
                  e.currentTarget.value
                    ? Number(e.currentTarget.value) * 100 + (rank % 100 || 3)
                    : 0,
                )
              }
            >
              <option value="">{r.challengeNone}</option>
              {COLOURS.map((colour, index) => (
                <option key={colour} value={index}>
                  {t.common.challenge[colour]}
                </option>
              ))}
            </select>
          </label>
          {rank > 0 && (
            <label className="select">
              <span className="select-label">{r.level}</span>
              <input
                key={version}
                className="field num rebuild-level-field"
                inputMode="numeric"
                pattern="\d{1,2}"
                maxLength={2}
                defaultValue={rank % 100}
                onBlur={(e) =>
                  setRank(
                    Math.floor(rank / 100) * 100 +
                      Math.max(1, Number.parseInt(e.currentTarget.value, 10) || 1),
                  )
                }
              />
            </label>
          )}
          <label className="select rebuild-intro">
            <span className="select-label">{r.intro}</span>
            <input
              key={version}
              className="field"
              maxLength={100}
              defaultValue={userProfile.intro}
              onBlur={(e) => setProfile({ intro: e.currentTarget.value })}
            />
          </label>
        </div>
      </section>
      <section className="panel">
        <h2 className="panel-title">{r.unlocks}</h2>
        <p className="meta rebuild-lead">{r.unlocksText}</p>
        {r.kinds.map((kind, index) => (
          <Keys
            key={kind}
            kind={index}
            draft={draft}
            onChange={(names, on) => setKeys(index, names, on)}
          />
        ))}
      </section>
      <form
        className="panel rebuild-finish"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(e.currentTarget);
        }}
      >
        <h2 className="panel-title">{profile ? r.send : r.finish}</h2>
        {!profile && (
          <label className="select">
            <span className="select-label">{r.name}</span>
            <input
              name="name"
              className="field"
              required
              maxLength={32}
              autoComplete="nickname"
              aria-describedby="rebuild-name-help"
              readOnly={!!phrase}
            />
            <span id="rebuild-name-help" className="meta small">
              {r.nameHelp}
            </span>
          </label>
        )}
        {phrase && (
          <div className="rebuild-phrase">
            <h3>{r.words}</h3>
            <p className="meta">{r.wordsText}</p>
            <ol className="ppp-words">
              {phrase.words.map((word, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a phrase's words never move, and may repeat
                <li key={index}>{word}</li>
              ))}
            </ol>
          </div>
        )}
        {lockedChapters(draft.songs).map(({ song, gate, score, have }) => (
          <p key={song} className="warning">
            {typeof gate === "number"
              ? r.lockedLegacy(catalogSong(song)!.chapter, gate, have, format.number(score))
              : r.locked(
                  catalogSong(song)!.chapter,
                  catalogSong(gate)!.title,
                  format.number(score),
                )}
          </p>
        ))}
        <p className="meta">{t.start.declared}</p>
        <p role="status" className="negative" hidden={!error}>
          {error}
        </p>
        <div className="rebuild-actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? r.working : profile ? r.send : phrase ? r.saved : r.create} <Arrow />
          </button>
          <button type="button" className="text-link" onClick={reset}>
            {r.reset}
          </button>
        </div>
      </form>
    </>
  );
}
