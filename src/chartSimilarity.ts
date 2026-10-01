import { useEffect, useState } from "react";
import { canonicalSongId, catalogRevision, catalogSongs } from "./catalog";
import type { SimilarityFn } from "./metrics";
import { LEVELS } from "./modules";

/*
 * How alike two charts are built (patterns, movement, rhythm, line choreography), from the vectors that
 * scripts/build-chart-similarity.ts writes to public/chart-similarity.bin. The file is small (~32 KB) and static,
 * so it's fetched once by the browser and every comparison runs client-side.
 *
 * File: "PHSM", u8 schema version, u8 dims, u16 LE chart count, u8 revision length, the catalog revision, then one
 * int8 vector per chart in catalog order (songs × LEVELS, skipping charts with no constant).
 */

/** Reads the vectors, or undefined when the file doesn't match this build's catalog. */
export function parseSimilarity(bytes: Uint8Array): SimilarityFn | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== "PHSM" || bytes[4] !== 1) return undefined;
  const dims = bytes[5]!;
  const count = view.getUint16(6, true);
  const revisionEnd = 9 + bytes[8]!;
  if (new TextDecoder().decode(bytes.subarray(9, revisionEnd)) !== catalogRevision)
    return undefined;
  const keys = catalogSongs.flatMap((song) =>
    LEVELS.flatMap((level, index) => (song.constants[index] == null ? [] : `${song.id}:${level}`)),
  );
  if (keys.length !== count || bytes.length !== revisionEnd + count * dims) return undefined;
  const raw = new Int8Array(bytes.buffer, bytes.byteOffset + revisionEnd, count * dims);
  const vectors = new Float32Array(count * dims);
  for (let row = 0; row < count; row++) {
    let norm = 0;
    for (let d = 0; d < dims; d++) norm += raw[row * dims + d]! ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dims; d++) vectors[row * dims + d] = raw[row * dims + d]! / norm;
  }
  const rows = new Map(keys.map((key, row) => [key, row]));
  const rowOf = (key: string) => {
    const split = key.lastIndexOf(":");
    return rows.get(`${canonicalSongId(key.slice(0, split))}${key.slice(split)}`);
  };
  return (a, b) => {
    const [rowA, rowB] = [rowOf(a), rowOf(b)];
    if (rowA === undefined || rowB === undefined) return undefined;
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += vectors[rowA * dims + d]! * vectors[rowB * dims + d]!;
    return dot;
  };
}

let loading: Promise<SimilarityFn | undefined> | undefined;
function loadSimilarity() {
  loading ??= fetch(`/chart-similarity.bin?v=${encodeURIComponent(catalogRevision)}`)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(response.status)))
    .then((buffer) => parseSimilarity(new Uint8Array(buffer)))
    .catch(() => undefined); // predictions just fall back to the chart constant alone
  return loading;
}

/** Chart similarity once its file has loaded (undefined until then, or if it can't be used). */
export function useChartSimilarity(): SimilarityFn | undefined {
  const [similarity, setSimilarity] = useState<{ fn?: SimilarityFn }>({});
  useEffect(() => {
    let live = true;
    loadSimilarity().then((fn) => live && setSimilarity({ fn }));
    return () => {
      live = false;
    };
  }, []);
  return similarity.fn;
}
