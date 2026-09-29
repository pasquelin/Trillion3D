import { readList, type DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { Primitive } from '../../../../sdk-core/src/world/object/mesh.ts';
import { computeNormals } from '../../../../sdk-core/src/world/geometry/normals.ts';
import { boxEmpty, boxExpandByPoint } from '../../../../sdk-core/src/math/primitives/box.ts';
import type { HeldBox } from '../page/runtimePrimitive.ts';
import { LISTS } from './worldDynamicRanges.ts';

/** The drawn box of `drawn`, joined to `declared` and `before`; widened by half its size when
 *  nothing was declared, so that a sheet that waves stays within the box it was cut in. */
export function heldBox(drawn: DrawnTriangles, declared: Geometry['maxBounds'], before?: HeldBox) {
  const box = new Float64Array(6),
    p = drawn.positions;
  boxEmpty(box, 0);
  for (let i = 0; i + 2 < p.length; i += 3) boxExpandByPoint(box, 0, p[i], p[i + 1], p[i + 2]);
  for (const c of declared ? [declared.min, declared.max] : [])
    boxExpandByPoint(box, 0, c.x, c.y, c.z);
  for (let k = 0; before && k < 6; k += 3)
    boxExpandByPoint(box, 0, before[k], before[k + 1], before[k + 2]);
  const pad = declared ? 0 : Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2], 1e-3) / 2;
  for (let a = 0; a < 6; a++) box[a] += a < 3 ? -pad : pad;
  return box;
}

/** Whether `next` draws the triangles `held` draws — the same corners, the same lists —, and
 *  within `box`: its vertices can then be written in place. */
export function fits(held: DrawnTriangles, next: DrawnTriangles, box: HeldBox) {
  if (held.indices.length !== next.indices.length) return false;
  for (let i = 0; i < held.indices.length; i++)
    if (held.indices[i] !== next.indices[i]) return false;
  for (const [list] of LISTS) if (held[list]?.length !== next[list]?.length) return false;
  return inBox(next.positions, box);
}

/** Whether every point of `p`, three numbers each, lies within `box`. */
export function inBox(p: ArrayLike<number>, box: ArrayLike<number>) {
  for (let i = 0; i < p.length; i++) if (p[i] < box[i % 3] || p[i] > box[(i % 3) + 3]) return false;
  return true;
}

/** What a dynamic resource reads each rewrite into: lists of its own, and the index its corners
 *  came from, at its version (#573). */
export type Reading = { next: DrawnTriangles; index: Geometry['index']; indexVersion: number };

/** The reading of `geometry`, first drawn as `drawn`: a copy of each of its lists. */
export function readingOf({ index }: Geometry, drawn: DrawnTriangles): Reading {
  const [positions, normals, uvs, colors] = LISTS.map(([list]) => drawn[list]?.slice() ?? null);
  return {
    next: { ...drawn, positions: positions!, normals: normals!, uvs, colors },
    index,
    indexVersion: index?.version ?? 0,
  };
}

/** Reads `geometry`'s plain triangles into `into.next`, in place, when they keep the corners and
 *  lists `into` was cut from, within its `box`; false otherwise: the caller reads them anew. */
export function readInPlace(
  geometry: Geometry,
  reading: Primitive,
  options: { wireframe?: boolean; flat?: boolean },
  into: Reading & { box: ArrayLike<number> },
) {
  const { next } = into,
    { position, normal } = geometry.attributes,
    index = geometry.index;
  if (reading !== 'triangles' || options.wireframe || options.flat || next.lines) return false;
  if (index !== into.index || (index?.version ?? 0) !== into.indexVersion) return false;
  if (!position || position.count * 3 !== next.positions.length) return false;
  for (let v = 0; v < position.count; v++)
    for (let c = 0; c < 3; c++)
      next.positions[v * 3 + c] = c < position.itemSize ? position.getComponent(v, c) : 0;
  // Every other list as `drawnTriangles` reads it; missing normals are made below.
  for (let l = 1; l < LISTS.length; l++) {
    const [field, name, width] = LISTS[l],
      out = next[field];
    if (!out && (geometry.attributes[name]?.count ?? -1) >= position.count) return false;
    if (out && !readList(geometry, name, width, position.count, out) && field !== 'normals')
      return false;
  }
  if (!inBox(next.positions, into.box)) return false;
  if (!normal || normal.count < position.count)
    computeNormals(next.positions, index?.array ?? null, next.normals);
  return true;
}
