import { useNavigate, useParams } from "@tanstack/react-router";
import { createContext, type RefObject, use, useEffect, useRef, useState } from "react";
import type { Account } from "./adb";
import { catalogRevision } from "./catalog";
import { MAX_JSON_SIZE, parseJsonDocument, type SaveDocumentV1 } from "./document";
import { calculateRanking } from "./metrics";
import { applyPalette } from "./palettes";
import type { SaveArchive } from "./save";
import {
  type Credential,
  listCredentials,
  listSnapshots,
  makeSnapshot,
  type SnapshotV1,
  saveCredential,
  saveSnapshot,
} from "./store";

export type Loaded = { document: SaveDocumentV1; archive?: SaveArchive; playerId?: string };

export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

interface SaveContextValue {
  loaded?: Loaded;
  /** The chart selected on Overview (`songId:LEVEL`); its song tints the background on every page. */
  chartKey: string;
  setChartKey: (value: string) => void;
  snapshots: SnapshotV1[];
  credentials: Credential[];
  selectedPlayer: string;
  setSelectedPlayer: (value: string) => void;
  log: string;
  token: string;
  setToken: (value: string) => void;
  busy: boolean;
  usbPhase: "connecting" | "done" | "error";
  usbEvents: string[];
  unsupportedZip?: { name: string; bytes: Uint8Array };
  storageReady: boolean;
  sync?: { playerId: string; state: "syncing" | "fresh" | "same" | "error" };
  dialog: RefObject<HTMLDialogElement | null>;
  usbDialog: RefObject<HTMLDialogElement | null>;
  usbLog: RefObject<HTMLDivElement | null>;
  fileInput: RefObject<HTMLInputElement | null>;
  say: (text: string) => void;
  refresh: () => Promise<void>;
  storeSave: (next: Loaded) => Promise<boolean>;
  cloudImport: (
    getSession: () => Promise<{ token: string; account?: Account }>,
    report?: (text: string) => void,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  syncPlayer: (credential: Credential) => Promise<void>;
  syncLabel: (playerId: string, idle: string) => string;
  closeUsb: () => void;
  resetUsbDialog: () => void;
  connectAndroid: () => Promise<void>;
  openFile: (file: File) => Promise<void>;
  openSnapshot: (snapshot: SnapshotV1) => Promise<void>;
}

const SaveContext = createContext<SaveContextValue | undefined>(undefined);

/** Everything the save-analyzer tool's tabs share: the loaded save, local history, import/sync flows and dialogs. */
export function useSave(): SaveContextValue {
  const value = use(SaveContext);
  if (!value) throw new Error("useSave() must be used within <SaveProvider>");
  return value;
}

export function SaveProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded>();
  const [chartKey, setChartKey] = useState("");
  const { id: pageSong } = useParams({ strict: false });
  const accentSong = pageSong ?? chartKey.slice(0, chartKey.lastIndexOf(":"));
  const [snapshots, setSnapshots] = useState<SnapshotV1[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [log, setLog] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [usbPhase, setUsbPhase] = useState<"connecting" | "done" | "error">("connecting");
  const [usbEvents, setUsbEvents] = useState<string[]>([]);
  const [unsupportedZip, setUnsupportedZip] = useState<{ name: string; bytes: Uint8Array }>();
  const [storageReady, setStorageReady] = useState(false);
  const [sync, setSync] = useState<{
    playerId: string;
    state: "syncing" | "fresh" | "same" | "error";
  }>();
  const syncing = useRef(false);
  const lastStored = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const usbDialog = useRef<HTMLDialogElement>(null);
  const usbLog = useRef<HTMLDivElement>(null);
  const usbCloseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const usbController = useRef<AbortController>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const say = (text: string) => setLog(text);
  const refresh = async () => {
    setSnapshots(await listSnapshots());
    setCredentials(await listCredentials());
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect; refresh/say aren't wrapped in useCallback (the project relies on the React Compiler instead), so listing them would re-run this every render.
  useEffect(() => {
    void refresh()
      .catch((error) => say(`✗ Snapshot storage unavailable: ${message(error)}`))
      .finally(() => setStorageReady(true));
    return () => {
      clearTimeout(usbCloseTimer.current);
      usbController.current?.abort();
    };
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
  useEffect(() => {
    if (!sync || sync.state === "syncing") return;
    const timer = setTimeout(() => setSync(undefined), sync.state === "error" ? 12_000 : 5_000);
    return () => clearTimeout(timer);
  }, [sync]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: usbEvents isn't read here, but re-scrolling on each new log line is the point.
  useEffect(() => {
    if (usbLog.current) usbLog.current.scrollTop = usbLog.current.scrollHeight;
  }, [usbEvents]);

  async function storeSave(next: Loaded) {
    if (!next.playerId) return false;
    const saved = await saveSnapshot(
      await makeSnapshot(next.document, next.archive, catalogRevision, next.playerId),
    );
    await refresh();
    lastStored.current = saved;
    say(
      saved
        ? "Saved snapshot locally in IndexedDB."
        : "This save is already in your local history.",
    );
    return saved;
  }
  function showSave(next: Loaded) {
    setLoaded(next);
    setChartKey(calculateRanking(next.document).charts[0]?.key ?? "");
    setUnsupportedZip(undefined);
    if (!syncing.current) void navigate({ to: "/" }); // a sync refreshes in place
    if (next.playerId) setSelectedPlayer(next.playerId);
  }
  async function imported(next: Loaded): Promise<boolean> {
    showSave(next);
    if (!next.playerId) {
      say("Save opened, but no player ID was assigned; it was not archived.");
      return false;
    }
    try {
      return await storeSave(next);
    } catch (error) {
      say(`✗ Save loaded, but local history could not be saved: ${message(error)}`);
      return false;
    }
  }
  function localPlayer(): string | undefined {
    const value = prompt(
      "Player ID for this local save (needed to group its history):",
      selectedPlayer || snapshots.find((s) => s.playerId)?.playerId || "",
    );
    const playerId = value?.trim();
    if (!playerId) return undefined;
    if (playerId.length > 128) throw new Error("Player ID is too long");
    return playerId;
  }
  async function ingestZip(
    bytes: Uint8Array,
    options: { kind: "cloud" | "zip"; name?: string; cloudUpdatedAt?: string; summary?: string },
    playerId?: string,
    signal?: AbortSignal,
  ) {
    const { openArchive, parseArchive } = await import("./save");
    const archive = await openArchive(bytes);
    signal?.throwIfAborted();
    let document: SaveDocumentV1;
    try {
      document = parseArchive(archive, options);
    } catch (error) {
      setLoaded(undefined);
      setChartKey("");
      setUnsupportedZip({ name: options.name || "unsupported-save.zip", bytes: archive.rawZip });
      throw new Error(`Semantic parsing stopped: ${message(error)}`);
    }
    signal?.throwIfAborted();
    const owner = playerId ?? (options.kind === "zip" ? localPlayer() : undefined);
    const stored = await imported({ document, archive, playerId: owner });
    if (stored)
      say(
        `Loaded ${document.songs.length} songs from ${archive.fingerprint.slice(0, 12)}… Saved to local history.`,
      );
  }
  async function cloudImport(
    getSession: () => Promise<{ token: string; account?: Account }>,
    report = say,
    signal?: AbortSignal,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const session = await getSession();
      signal?.throwIfAborted();
      const api = await import("./save");
      signal?.throwIfAborted();
      const identity = await api.identifyPlayer(session.token, signal);
      signal?.throwIfAborted();
      if (session.account?.objectId && session.account.objectId !== identity.objectId)
        throw new Error("The device account does not match this token");
      await saveCredential({
        playerId: identity.objectId,
        nickname: identity.nickname ?? session.account?.nickname,
        token: session.token,
      });
      await refresh();
      report("Checking cloud saves …");
      const saves = await api.listSaves(session.token, signal);
      if (!saves.length) throw new Error("That account has no cloud saves yet");
      const save = saves[0]!;
      report(`Fetching “${save.name}” from ${new URL(save.gameFile.url).host}…`);
      await ingestZip(
        await api.fetchSaveBytes(save, signal),
        { kind: "cloud", name: save.name, cloudUpdatedAt: save.updatedAt, summary: save.summary },
        identity.objectId,
        signal,
      );
      report("✓ Save loaded. Ready to go.");
      return true;
    } catch (error) {
      if (!signal?.aborted) report(`✗ ${message(error)}`);
      return false;
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  /** Re-fetch the newest cloud save with a remembered session token. */
  async function syncPlayer(credential: Credential) {
    if (busy) return;
    syncing.current = true;
    lastStored.current = false;
    setSync({ playerId: credential.playerId, state: "syncing" });
    const ok = await cloudImport(async () => credential);
    syncing.current = false;
    setSync({
      playerId: credential.playerId,
      state: ok ? (lastStored.current ? "fresh" : "same") : "error",
    });
  }
  function syncLabel(playerId: string, idle: string) {
    if (sync?.playerId !== playerId) return idle;
    return {
      syncing: "Syncing…",
      fresh: "New save fetched",
      same: "Already up to date",
      error: "Sync failed",
    }[sync.state];
  }
  /** The fade-out is pure CSS (see #usbDialog in style.css). */
  function closeUsb() {
    usbDialog.current?.close();
  }
  /** The dialog's native "close" event (Escape, the button, or the auto-close timer): cancel the import and reset for next time. */
  function resetUsbDialog() {
    clearTimeout(usbCloseTimer.current);
    usbController.current?.abort();
    usbController.current = undefined;
    setBusy(false);
  }
  async function connectAndroid() {
    clearTimeout(usbCloseTimer.current);
    const controller = new AbortController();
    usbController.current = controller;
    setUsbPhase("connecting");
    setUsbEvents(["Waiting for your phone…"]);
    usbDialog.current?.showModal();
    const report = (text: string) => {
      if (controller.signal.aborted) return;
      say(text);
      setUsbEvents((events) => [...events, text]);
    };
    const success = await cloudImport(
      async () => (await import("./adb")).readSessionToken(report, controller.signal),
      report,
      controller.signal,
    );
    if (controller.signal.aborted) return;
    if (success) {
      setUsbPhase("done");
      usbCloseTimer.current = setTimeout(closeUsb, 5000);
    } else setUsbPhase("error");
  }
  async function openFile(file: File) {
    setBusy(true);
    try {
      if (file.size > MAX_JSON_SIZE)
        throw new Error(`Import exceeds the ${MAX_JSON_SIZE / 1_000_000} MB limit`);
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
    selectedPlayer,
    setSelectedPlayer,
    log,
    token,
    setToken,
    busy,
    usbPhase,
    usbEvents,
    unsupportedZip,
    storageReady,
    sync,
    dialog,
    usbDialog,
    usbLog,
    fileInput,
    say,
    refresh,
    storeSave,
    cloudImport,
    syncPlayer,
    syncLabel,
    closeUsb,
    resetUsbDialog,
    connectAndroid,
    openFile,
    openSnapshot,
  };
  return <SaveContext value={value}>{children}</SaveContext>;
}
