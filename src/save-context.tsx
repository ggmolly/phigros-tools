import { useNavigate, useParams } from "@tanstack/react-router";
import { createContext, type RefObject, use, useEffect, useRef, useState } from "react";
import { catalogRevision } from "./catalog";
import { MAX_JSON_SIZE, parseJsonDocument, type SaveDocumentV1 } from "./document";
import type { Home } from "./home";
import { useFormat, useT } from "./i18n";
import { AppError, errorText } from "./i18n/errors";
import { useLive } from "./live";
import { calculateRanking } from "./metrics";
import { recordLines } from "./modules";
import { applyPalette } from "./palettes";
import type { Me, Signer } from "./phigrospp";
import type { SaveArchive } from "./save";
import {
  type Credential,
  deleteCredential,
  listCredentials,
  listSnapshots,
  makeSnapshot,
  type SnapshotV1,
  saveCredential,
  saveSnapshot,
} from "./store";
import { topics } from "./topics";

export type Loaded = { document: SaveDocumentV1; archive?: SaveArchive; playerId?: string };

/** Anything thrown, as text in the page's language (see AppError). */
export const message = (error: unknown) => errorText(error);

interface SaveContextValue {
  loaded?: Loaded;
  /** The chart selected on Overview (`songId:LEVEL`); its song tints the background on every page. */
  chartKey: string;
  setChartKey: (value: string) => void;
  snapshots: SnapshotV1[];
  credentials: Credential[];
  log: string;
  busy: boolean;
  unsupportedZip?: { name: string; bytes: Uint8Array };
  storageReady: boolean;
  /** The Phigros++ profile this browser is signed in to: the page's cookie until storage is read, then its key. */
  account?: string;
  /** That profile's public page as the server rendered it with the page. */
  home: Home | null;
  /** Opens the Phigros++ sign-in (set by <SignInDialog>). */
  openSignIn: RefObject<(() => void) | undefined>;
  fileInput: RefObject<HTMLInputElement | null>;
  say: (text: string) => void;
  /** Signs this browser in to a Phigros++ profile with a code or the recovery phrase, then opens its save. */
  signIn: (how: { code: string } | { phrase: string }) => Promise<void>;
  signOut: (credential: Credential) => Promise<void>;
  /** Sends a snapshot's original save to a Phigros++ profile, for its game to offer. */
  sendToPhigrospp: (rawZip: Uint8Array, credential: Credential) => Promise<void>;
  /**
   * Puts a save rebuilt on the site on a Phigros++ profile, its records declared: the signed-in one, whose game offers
   * it, or a new one made from a recovery phrase's seed, whose save it becomes.
   */
  publish: (document: SaveDocumentV1, create?: { name: string; seed: Uint8Array }) => Promise<void>;
  openFile: (file: File) => Promise<void>;
  openSnapshot: (snapshot: SnapshotV1) => Promise<void>;
}

const SaveContext = createContext<SaveContextValue | undefined>(undefined);

/** Everything the save-analyzer tool's tabs share: the loaded save, local history, import flows and dialogs. */
export function useSave(): SaveContextValue {
  const value = use(SaveContext);
  if (!value) throw new Error("useSave() must be used within <SaveProvider>");
  return value;
}

export function SaveProvider({ children, home }: { children: React.ReactNode; home: Home | null }) {
  const t = useT();
  const format = useFormat();
  const navigate = useNavigate();
  // a signed-in Phigros++ player's page renders with their save on the server (see getHome)
  const [loaded, setLoaded] = useState<Loaded | undefined>(
    home?.document && { document: home.document, playerId: home.id },
  );
  const [chartKey, setChartKey] = useState(
    () => (home?.document && calculateRanking(home.document).charts[0]?.key) ?? "",
  );
  const { id: pageSong } = useParams({ strict: false });
  const accentSong = pageSong ?? chartKey.slice(0, chartKey.lastIndexOf(":"));
  const [snapshots, setSnapshots] = useState<SnapshotV1[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [unsupportedZip, setUnsupportedZip] = useState<{ name: string; bytes: Uint8Array }>();
  const [storageReady, setStorageReady] = useState(false);
  const account = storageReady ? credentials.find((c) => c.signer)?.playerId : home?.id;
  // when the newest save the page has of the profile was uploaded (ms): the profile's stream only fetches newer ones
  const pulled = useRef(Date.parse(home?.document?.source.cloudUpdatedAt ?? "") || 0);
  const pulling = useRef(false);
  const inPlace = useRef(false);
  const openSignIn = useRef<() => void>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const say = (text: string) => setLog(text);
  const refresh = async () => {
    setSnapshots(await listSnapshots());
    setCredentials(await listCredentials());
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect; refresh/say aren't wrapped in useCallback (the project relies on the React Compiler instead), so listing them would re-run this every render.
  useEffect(() => {
    void refresh()
      .catch((error) => say(`✗ ${t.save.storageUnavailable(message(error))}`))
      .finally(() => setStorageReady(true));
    // a Phigros++ player signed in before the cookie existed gets it, their save comes from the profile's stream
    void listCredentials()
      .then(async (list) => {
        const signedIn = list.find((c) => c.signer);
        // a cookie whose key this browser no longer has is forgotten too
        if (!signedIn && home) await fetch("/api/session", { method: "DELETE" });
        if (signedIn && home?.id !== signedIn.playerId) await startSession(signedIn);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!accentSong) {
      applyPalette(undefined);
      return;
    }
    let current = true; // a slower import for an earlier song mustn't overwrite this one
    void import("./song-palettes").then(({ songPalette }) => {
      if (current) applyPalette(songPalette(accentSong));
    });
    return () => {
      current = false;
    };
  }, [accentSong]);

  async function storeSave(next: Loaded) {
    if (!next.playerId) return false;
    const saved = await saveSnapshot(
      await makeSnapshot(next.document, next.archive, catalogRevision, next.playerId),
    );
    await refresh();
    say(saved ? t.save.snapshotSaved : t.save.alreadySaved);
    return saved;
  }
  function showSave(next: Loaded) {
    setLoaded(next);
    setChartKey(calculateRanking(next.document).charts[0]?.key ?? "");
    setUnsupportedZip(undefined);
    if (!inPlace.current) void navigate({ to: "/" });
    if (next.playerId) setSelectedPlayer(next.playerId);
  }
  async function imported(next: Loaded): Promise<boolean> {
    showSave(next);
    if (!next.playerId) {
      say(t.save.noPlayerId);
      return false;
    }
    try {
      return await storeSave(next);
    } catch (error) {
      say(`✗ ${t.save.historyFailed(message(error))}`);
      return false;
    }
  }
  function localPlayer(): string | undefined {
    const value = prompt(
      t.save.playerPrompt,
      selectedPlayer || snapshots.find((s) => s.playerId)?.playerId || "",
    );
    const playerId = value?.trim();
    if (!playerId) return undefined;
    if (playerId.length > 128) throw new Error(t.save.playerIdTooLong);
    return playerId;
  }
  async function ingestZip(
    bytes: Uint8Array,
    options: {
      kind: "zip" | "phigrospp";
      name?: string;
      cloudUpdatedAt?: string;
      summary?: string;
    },
    playerId?: string,
  ) {
    const { openArchive, parseArchive } = await import("./save");
    const archive = await openArchive(bytes);
    let document: SaveDocumentV1;
    try {
      document = parseArchive(archive, options);
    } catch (error) {
      setLoaded(undefined);
      setChartKey("");
      setUnsupportedZip({ name: options.name || "unsupported-save.zip", bytes: archive.rawZip });
      throw new Error(t.save.parseStopped(message(error)));
    }
    const owner = playerId ?? (options.kind === "zip" ? localPlayer() : undefined);
    const stored = await imported({ document, archive, playerId: owner });
    if (stored) say(t.save.loadedSongs(document.songs.length, archive.fingerprint.slice(0, 12)));
  }
  /** The save a Phigros++ profile's game uploaded. */
  async function phigrosppImport(credential: Credential) {
    setBusy(true);
    pulling.current = true;
    try {
      const ppp = await import("./phigrospp");
      const response = await ppp.call(credential.signer!, "POST", "/api/save");
      if (response.status === 404) throw new AppError("pppNoSave");
      if (!response.ok) await ppp.answer(response);
      const { updated, summary, ...modules } = ppp.unpack(
        new Uint8Array(await response.arrayBuffer()),
      );
      const { zipSync } = await import("fflate");
      const decode = (bytes?: Uint8Array) => bytes && new TextDecoder().decode(bytes);
      pulled.current = Number(decode(updated));
      await ingestZip(
        zipSync(modules),
        {
          kind: "phigrospp",
          cloudUpdatedAt: new Date(pulled.current).toISOString(),
          summary: decode(summary),
        },
        credential.playerId,
      );
    } catch (error) {
      if (error instanceof AppError && error.key === "pppRemoved") {
        await deleteCredential(credential.playerId);
        await refresh();
      }
      say(`✗ ${message(error)}`);
    } finally {
      pulling.current = false;
      setBusy(false);
    }
  }
  // the save the profile's game uploads opens on its own, in place of the open one. a save of another player stays
  // open, the profile's comes with its next event
  useLive([account && topics.player(account)], (event, data) => {
    if (event !== "save") return;
    const credential = credentials.find((c) => c.signer && c.playerId === account);
    if (!credential || pulling.current || Number(data) <= pulled.current) return;
    if (loaded && loaded.playerId !== credential.playerId) return;
    inPlace.current = true;
    void phigrosppImport(credential).finally(() => {
      inPlace.current = false;
    });
  });
  /** The cookie the signed-in player's pages render with (server/session.ts). */
  async function startSession(credential: Credential) {
    const ppp = await import("./phigrospp");
    await ppp.answer(await ppp.call(credential.signer!, "POST", "/api/session"));
  }
  /** This browser's new key on a profile is remembered, and the profile's save opens. */
  async function joined({ signer, me }: { signer: Signer; me: Me }) {
    const credential = { playerId: me.id, nickname: me.name, signer };
    await saveCredential(credential);
    await refresh();
    await startSession(credential);
    await phigrosppImport(credential);
  }
  async function signIn(how: { code: string } | { phrase: string }) {
    const ppp = await import("./phigrospp");
    await joined(
      "code" in how ? await ppp.redeem(how.code) : await ppp.signInWithPhrase(how.phrase),
    );
  }
  async function signOut(credential: Credential) {
    const ppp = await import("./phigrospp");
    const signer = credential.signer!;
    // the server forgets this browser's key too, it's only kept here otherwise
    await ppp.call(signer, "DELETE", "/api/devices", signer.public.toHex()).catch(() => undefined);
    await fetch("/api/session", { method: "DELETE" });
    await deleteCredential(credential.playerId);
    setLoaded(undefined);
    await refresh();
    void navigate({ to: "/" });
  }
  async function sendToPhigrospp(rawZip: Uint8Array, credential: Credential) {
    const ppp = await import("./phigrospp");
    const { unzipSync } = await import("fflate");
    await ppp.answer(
      await ppp.call(credential.signer!, "PUT", "/api/offer", ppp.pack(unzipSync(rawZip))),
    );
  }
  async function publish(document: SaveDocumentV1, create?: { name: string; seed: Uint8Array }) {
    const ppp = await import("./phigrospp");
    const { buildSave } = await import("./save");
    const save = ppp.pack(await buildSave(document));
    const signer = create
      ? await ppp.seedSigner(create.seed)
      : credentials.find((c) => c.signer)!.signer!;
    const put = async (path: string, body: Uint8Array | string) =>
      ppp.answer(await ppp.call(signer, "PUT", path, body));
    if (create) {
      const { intro, avatar, background } = document.profile!;
      await put("/api/profile", JSON.stringify({ name: create.name, intro, avatar, background }));
    }
    // declared first: a save loaded without it would send its records as the game's own
    await put("/api/declared", recordLines(document.songs));
    await put(create ? "/api/save" : "/api/offer", save);
    if (!create) return;
    inPlace.current = true;
    await joined(await ppp.joinBrowser(signer)).finally(() => {
      inPlace.current = false;
    });
  }
  async function openFile(file: File) {
    setBusy(true);
    try {
      if (file.size > MAX_JSON_SIZE)
        throw new Error(t.save.tooLarge(format.number(MAX_JSON_SIZE / 1_000_000)));
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] === 0x50 && bytes[1] === 0x4b)
        await ingestZip(bytes, { kind: "zip", name: file.name });
      else {
        const document = parseJsonDocument(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        await imported({
          document: {
            ...document,
            source: {
              ...document.source,
              kind: "json",
              importedAt: new Date().toISOString(),
              name: file.name,
            },
          },
          playerId: localPlayer(),
        });
      }
    } catch (error) {
      say(`✗ ${message(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function openSnapshot(snapshot: SnapshotV1) {
    try {
      const archive = snapshot.rawZip
        ? await (await import("./save")).openArchive(snapshot.rawZip)
        : undefined;
      showSave({ document: snapshot.document, archive, playerId: snapshot.playerId });
    } catch (error) {
      say(`✗ ${message(error)}`);
    }
  }
  const value: SaveContextValue = {
    loaded,
    chartKey,
    setChartKey,
    snapshots,
    credentials,
    log,
    busy,
    unsupportedZip,
    storageReady,
    account,
    home,
    openSignIn,
    fileInput,
    say,
    signIn,
    signOut,
    sendToPhigrospp,
    publish,
    openFile,
    openSnapshot,
  };
  return <SaveContext value={value}>{children}</SaveContext>;
}
