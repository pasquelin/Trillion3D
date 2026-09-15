import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/** Entries one counting group of the compaction covers. Item ranges are aligned on it, so a group
 *  never spans two items and the per-item prefix is a walk over whole groups. */
export const TRANSPARENT_GROUP = 64;
/** Padding entry: an index no cluster has, never selected, never drawn. */
export const TRANSPARENT_NONE = 0xffffffff;

export type TransparentTable = ReturnType<typeof createTransparentTable>;

/** The draw rank of a transparent cluster: the rank its source recorded, the catalogue rank else. */
const drawRank = (rec: PageRec) => rec.sourceOrder ?? rec.id;

/**
 * The static draw order of every transparent cluster, item by item.
 *
 * A transparent primitive draws its clusters in the order its source recorded — `sourceOrder`, the
 * rank the compiler wrote on each page — and that order is a property of the scene, not of the
 * image: the set selected changes every frame, the order it must be drawn in never does. So the
 * whole catalogue is sorted once here, and what an image adds is only *which* of those entries it
 * keeps. A compaction that preserves the order of its input therefore preserves the draw order
 * exactly, with no sort and no CPU list per image.
 *
 * Each item owns a range aligned on `TRANSPARENT_GROUP`, and its instance list is written in place
 * inside that range, so an item's base is known before the image starts and never moves.
 */
export function createTransparentTable(
  packedPages: readonly PageRec[],
  items: readonly BlendGpuItem[],
) {
  const pagesByMesh = new Map<THREE.Mesh, number[]>();
  for (let i = 0; i < packedPages.length; i++) {
    const rec = packedPages[i];
    if (!rec.transparent || !rec.sourceMesh) continue;
    const list = pagesByMesh.get(rec.sourceMesh);
    if (list) list.push(i);
    else pagesByMesh.set(rec.sourceMesh, [i]);
  }
  const paged = items.filter((item) => item.paged);
  const orders: number[][] = [];
  let length = 0,
    maxVertexWords = 0;
  for (const item of paged) {
    const list = item.sourceMesh ? (pagesByMesh.get(item.sourceMesh) ?? []) : [];
    // `sort` is stable, so clusters sharing a source rank keep their catalogue order — the same
    // tie-break every other reader of the catalogue sees.
    const order = list.slice().sort((a, b) => drawRank(packedPages[a]) - drawRank(packedPages[b]));
    orders.push(order);
    length += Math.ceil(order.length / TRANSPARENT_GROUP) * TRANSPARENT_GROUP;
  }
  const capacity = Math.max(TRANSPARENT_GROUP, length);
  const entries = new Uint32Array(capacity).fill(TRANSPARENT_NONE);
  /** Words of the resident page, then the index words it holds: what one instance draws. */
  const spans = new Uint32Array(capacity * 2);
  const pageOfEntry = new Int32Array(capacity).fill(-1);
  const entryOfPage = new Int32Array(Math.max(1, packedPages.length)).fill(-1);
  const itemRanges = new Uint32Array(Math.max(1, paged.length) * 2);
  let at = 0;
  for (let item = 0; item < paged.length; item++) {
    const order = orders[item];
    itemRanges[item * 2] = at;
    itemRanges[item * 2 + 1] = order.length;
    for (let i = 0; i < order.length; i++) {
      const pageIndex = order[i],
        entry = at + i,
        words = packedPages[pageIndex].triangles * 3;
      entries[entry] = pageIndex;
      pageOfEntry[entry] = pageIndex;
      entryOfPage[pageIndex] = entry;
      spans[entry * 2 + 1] = words;
      if (words > maxVertexWords) maxVertexWords = words;
    }
    at += Math.ceil(order.length / TRANSPARENT_GROUP) * TRANSPARENT_GROUP;
  }
  return {
    entries,
    spans,
    pageOfEntry,
    entryOfPage,
    itemRanges,
    /** Items the table describes, in the order the transparent pass draws them. */
    pagedItems: paged,
    /** Entries in use, padding excluded. */
    length,
    capacity,
    groupCount: Math.max(1, Math.ceil(capacity / TRANSPARENT_GROUP)),
    /** Vertices one instance draws: the longest index run any transparent cluster holds. */
    maxVertexWords,
  };
}
