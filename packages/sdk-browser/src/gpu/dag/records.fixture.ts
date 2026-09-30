/**
 * The oracle's decoder of a packing, the mirror of `shader/recordWgsl.ts`: every accessor takes a
 * PAGE — an index of the catalogue, one per placement — and reads the record that page shares
 * with the other placements of its primitive. No rank is rewritten here: they are `layout.ts`'s,
 * so none can diverge from the one the GPU reads.
 */
import { SELECTION_NONE as NONE } from '../core/selection.ts';
import type { PackedDag } from './types.ts';
import {
  CLUSTER_WORDS,
  COLD_CONE,
  COLD_HAS_BOX,
  COLD_MAX,
  COLD_MIN,
  COLD_OWNER,
  COLD_TRIANGLES,
  COLD_WORDS,
  HOT_FLAGS,
  HOT_LOD_ERROR,
  HOT_PARENT_ERROR,
  HOT_PARENT_SPHERE,
  HOT_SPHERE,
  coldBase,
} from './layout.ts';

export type DagRecords = {
  hot: Float32Array;
  hotInts: Uint32Array;
  cold: Float32Array;
  coldInts: Uint32Array;
  /** First cold record in `cold`, behind the working table and the residency bits. */
  coldAt: number;
  recordShift: Uint32Array;
  rootBases: Uint32Array;
};
export function dagRecords(
  packed: Pick<PackedDag, 'clusters' | 'pageCones' | 'pageCount' | 'recordShift' | 'rootBases'>,
): DagRecords {
  const { clusters, pageCones } = packed;
  return {
    hot: clusters,
    hotInts: new Uint32Array(clusters.buffer, clusters.byteOffset, clusters.length),
    cold: pageCones,
    coldInts: new Uint32Array(pageCones.buffer, pageCones.byteOffset, pageCones.length),
    coldAt: coldBase(packed.pageCount),
    recordShift: packed.recordShift,
    rootBases: packed.rootBases,
  };
}

/** The page's placement: its word in the working table. */
export const worldOf = (r: DagRecords, i: number) => r.coldInts[i];
/** The record the page reads: its index plus its placement's shift, wrapping as the u32 add does. */
const recordOf = (r: DagRecords, i: number) => (i + r.recordShift[worldOf(r, i)]) >>> 0;
const coldOf = (r: DagRecords, i: number) => r.coldAt + recordOf(r, i) * COLD_WORDS;

export const flagsOf = (r: DagRecords, i: number) =>
  r.hotInts[recordOf(r, i) * CLUSTER_WORDS + HOT_FLAGS];
/** Cut node that owns the page: the placement's first node plus the record's relative owner. */
export function ownerOf(r: DagRecords, i: number) {
  const local = r.coldInts[coldOf(r, i) + COLD_OWNER];
  return local === NONE ? NONE : r.rootBases[worldOf(r, i)] + local;
}
export const hasBoxOf = (r: DagRecords, i: number) => r.cold[coldOf(r, i) + COLD_HAS_BOX];
/** Cluster triangles, as an integer word: the shader's `trianglesOf` is the mirror. */
export const trianglesOf = (r: DagRecords, i: number) => r.coldInts[coldOf(r, i) + COLD_TRIANGLES];
/** `at` is 0 for the cluster's band, 1 for its parent's: same pairs as in the shader. */
export const bandError = (r: DagRecords, i: number, at: number) =>
  r.hot[recordOf(r, i) * CLUSTER_WORDS + (at === 0 ? HOT_LOD_ERROR : HOT_PARENT_ERROR)];
export const bandSphere = (r: DagRecords, i: number, at: number) =>
  recordOf(r, i) * CLUSTER_WORDS + (at === 0 ? HOT_SPHERE : HOT_PARENT_SPHERE);

export function boxInto(r: DagRecords, i: number, min: number[], max: number[]) {
  const base = coldOf(r, i);
  for (let a = 0; a < 3; a++) {
    min[a] = r.cold[base + COLD_MIN + a];
    max[a] = r.cold[base + COLD_MAX + a];
  }
}
export function coneInto(r: DagRecords, i: number, cone: { axis: number[]; angle: number }) {
  const base = coldOf(r, i) + COLD_CONE;
  for (let a = 0; a < 3; a++) cone.axis[a] = r.cold[base + a];
  cone.angle = r.cold[base + 3];
}
