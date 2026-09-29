import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import { boxEmpty, boxExpandByPoint } from '../../../../sdk-core/src/math/primitives/box.ts';
import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import type { Cut } from './worldCuts.ts';

/** The lists of drawn triangles, the host attribute each is and its floats per vertex. */
export const LISTS = [
  ['positions', 'position', 3],
  ['normals', 'normal', 3],
  ['uvs', 'uv', 2],
  ['colors', 'color', 4],
] as const;
const INDEX = { position: 0, normal: 1, uv: 2, color: 3 } as const;

/**
 * What `next` changed of `held`, list by list: the range from its first changed vertex to its
 * last, the bytes those ranges weigh — the upload, nothing else —, and the box of the moved
 * vertices where they were and where they go: the shadow pages they leave and those they reach.
 */
export function changedRanges(held: DrawnTriangles, next: DrawnTriangles) {
  const ranges: VertexRange[] = [],
    box = new Float64Array(6);
  let bytes = 0;
  boxEmpty(box, 0);
  for (const [field, name, width] of LISTS) {
    const a = held[field],
      b = next[field];
    if (!a || !b) continue;
    let first = -1,
      last = -1;
    for (let i = 0; i < a.length; i++)
      if (a[i] !== b[i]) {
        if (first < 0) first = i;
        last = i;
      }
    if (first < 0) continue;
    const from = Math.floor(first / width),
      count = Math.floor(last / width) + 1 - from;
    ranges.push({ name, from, count });
    bytes += count * width * 4;
    if (field === 'positions')
      for (let v = from * 3; v < (from + count) * 3; v += 3) {
        boxExpandByPoint(box, 0, a[v], a[v + 1], a[v + 2]);
        boxExpandByPoint(box, 0, b[v], b[v + 1], b[v + 2]);
      }
  }
  return { ranges, bytes, box };
}

/** Writes `ranges` of `next` into `held`, in place: what the session reads next. */
export function copyRanges(held: DrawnTriangles, next: DrawnTriangles, ranges: VertexRange[]) {
  for (const { name, from, count } of ranges) {
    const [field, , width] = LISTS[INDEX[name]];
    held[field]!.set(next[field]!.subarray(from * width, (from + count) * width), from * width);
  }
}

/** Marks `ranges` of `geometry`'s lists written: a reader that uploads them sends those alone —
 *  the WebGL2 draw, which clears them; the WebGPU path is handed the ranges themselves. */
export function markRewritten(geometry: Geometry, ranges: readonly VertexRange[]) {
  for (const { name, from, count } of ranges) {
    const list = geometry.attributes[name] as BufferAttribute,
      start = from * list.itemSize,
      end = (from + count) * list.itemSize;
    // One range held, the union of those no reader took yet: a list nobody uploads never grows.
    const [held] = list.updateRanges;
    if (!held) list.addUpdateRange(start, end - start);
    else {
      const first = Math.min(held.start, start);
      held.count = Math.max(held.start + held.count, end) - first;
      held.start = first;
    }
    list.needsUpdate = true;
  }
}

type Session = {
  updateVertices(
    attributes: Geometry['attributes'],
    ranges: VertexRange[],
    box: Float64Array,
  ): boolean;
};
/** What a frame's `upload` hands each dynamic resource's rewritten ranges to (#573): its placed
 *  host geometry, marked, then `session`; false while the session draws no such resource — it
 *  waits —, `refused` when the session cannot take them in place. */
export const vertexWriter =
  (session: Session, geometryOf: (cut: Cut) => Geometry | undefined, refused: () => void) =>
  (cut: Cut, ranges: VertexRange[], box: Float64Array) => {
    const geometry = geometryOf(cut);
    if (!geometry) return false;
    markRewritten(geometry, ranges);
    if (!session.updateVertices(geometry.attributes, ranges, box)) refused();
    return true;
  };
