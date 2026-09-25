import type { SaveDocumentV1 } from "./document";
import type { SaveArchive } from "./save";

export interface SnapshotV1 {
  schemaVersion: 1;
  id: string;
  capturedAt: string;
  catalogRevision: string;
  document: SaveDocumentV1;
  rawZip?: Uint8Array;
  playerId?: string; // v1 snapshots have no known owner
}

export interface Credential {
  playerId: string;
  nickname?: string;
  token: string;
}

const DATABASE = "phigros-web-save";
const STORE = "snapshots";
const CREDENTIALS = "credentials";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CREDENTIALS))
        db.createObjectStore(CREDENTIALS, { keyPath: "playerId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function makeSnapshot(
  document: SaveDocumentV1,
  archive: SaveArchive | undefined,
  catalogRevision: string,
  playerId: string,
): Promise<SnapshotV1> {
  // Ignore source metadata, which changes on every import even for identical save contents.
  const content = JSON.stringify({ ...document, source: undefined });
  const fingerprint =
    archive?.fingerprint ??
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)),
    ).toHex();
  return {
    schemaVersion: 1,
    id: `${playerId}:${fingerprint}`,
    capturedAt: new Date().toISOString(),
    catalogRevision,
    playerId,
    document,
    ...(archive ? { rawZip: archive.rawZip } : {}),
  };
}

export async function saveSnapshot(snapshot: SnapshotV1): Promise<boolean> {
  const existing = await transaction<SnapshotV1 | undefined>(STORE, "readonly", (store) =>
    store.get(snapshot.id),
  );
  if (existing) return false;
  await transaction(STORE, "readwrite", (store) => store.add(snapshot));
  return true;
}

export async function listSnapshots(): Promise<SnapshotV1[]> {
  const snapshots = await transaction<SnapshotV1[]>(STORE, "readonly", (store) => store.getAll());
  return snapshots.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export async function deleteSnapshot(id: string): Promise<void> {
  await transaction(STORE, "readwrite", (store) => store.delete(id));
}

export async function clearSnapshots(): Promise<void> {
  await transaction(STORE, "readwrite", (store) => store.clear());
}

export async function listCredentials(): Promise<Credential[]> {
  return transaction<Credential[]>(CREDENTIALS, "readonly", (store) => store.getAll());
}

export async function saveCredential(credential: Credential): Promise<void> {
  await transaction(CREDENTIALS, "readwrite", (store) => store.put(credential));
}

export async function deleteCredential(playerId: string): Promise<void> {
  await transaction(CREDENTIALS, "readwrite", (store) => store.delete(playerId));
}
