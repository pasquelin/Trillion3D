import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { Primitive } from '../../../../sdk-core/src/world/object/mesh.ts';
import { computeNormals } from '../../../../sdk-core/src/world/geometry/normals.ts';
import { readComponent } from '../../../../sdk-core/src/world/geometry/bounds.ts';
import { boxEmpty, boxExpandByPoint } from '../../../../sdk-core/src/math/primitives/box.ts';
import type { HeldBox } from '../page/runtimePrimitive.ts';
import { LISTS } from './worldDynamicRanges.ts';

// How a dynamic resource (`worldDynamic.ts`, #573) reads its geometry: the box it is held in, and
// its lists rewritten in place while its corners stay.

/** The drawn box of `drawn`, joined to `declared` and `before`; widened by half its size when
 *  nothing was declared, so that a sheet that waves stays within the box it was cut in. */
export function heldBox(drawn: DrawnTriangles, declared: Geometry['maxBounds'], before?: HeldBox) {
  const box = new Float64Array(6);
  boxEmpty(box, 0);
  const p = drawn.positions;
  for (let i = 0; i + 2 < p.length; i += 3) boxExpandByPoint(box, 0, p[i], p[i + 1], p[i + 2]);
  if (declared) {
    boxExpandByPoint(box, 0, declared.min.x, declared.min.y, declared.min.z);
    boxExpandByPoint(box, 0, declared.max.x, declared.max.y, declared.max.z);
  }
  if (before) {
    boxExpandByPoint(box, 0, before[0], before[1], before[2]);
    boxExpandByPoint(box, 0, before[3], before[4], before[5]);
  }
  const pad = declared ? 0 : Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2], 1e-3) / 2;
  for (let a = 0; a < 3; a++) {
    box[a] -= pad;
    box[a + 3] += pad;
  }
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

/** What a dynamic resource reads its geometry into: its lists, the index it was cut from at its
 *  version, and whether its normals are computed, the geometry declaring none. */
export type Reading = {
  next: DrawnTriangles;
  index: Geometry['index'];
  indexVersion: number;
  computed: boolean;
};

/** The reading of `geometry`, first drawn as `drawn`: lists of their own, the same corners. */
export function readingOf(geometry: Geometry, drawn: DrawnTriangles): Reading {
  const { index, attributes } = geometry,
    normal = attributes.normal;
  return {
    next: {
      ...drawn,
      positions: drawn.positions.slice(),
      normals: drawn.normals.slice(),
      uvs: drawn.uvs?.slice() ?? null,
      colors: drawn.colors?.slice() ?? null,
    },
    index,
    indexVersion: index?.version ?? 0,
    computed: !normal || normal.count * 3 < drawn.positions.length,
  };
}

/**
 * Reads `geometry`'s plain triangles into `into.next`, in place, when they keep the corners and
 * lists `into` was cut from and lie within its `box`: a rewritten geometry read with no allocation
 * (#573). False otherwise — another reading, corners or lists, or a vertex out of the box —: the
 * caller reads it anew.
 */
export function readInPlace(
  geometry: Geometry,
  reading: Primitive,
  options: { wireframe?: boolean; flat?: boolean },
  into: Reading & { box: ArrayLike<number> },
) {
  const { next } = into,
    position = geometry.attributes.position,
    index = geometry.index;
  if (reading !== 'triangles' || options.wireframe || options.flat || next.lines) return false;
  if (index !== into.index || (index?.version ?? 0) !== into.indexVersion) return false;
  if (!position || position.count * 3 !== next.positions.length) return false;
  for (const [field, name, width] of LISTS) {
    const list = geometry.attributes[name],
      out = next[field];
    // A position reads at its value, a missing component 0; another list as the geometry reads it.
    const computed = field === 'normals' && into.computed,
      missing = field === 'positions' ? 0 : 1;
    const present = !!list && list.count >= position.count;
    if (present !== (!computed && !!out)) return false;
    if (!list || !out || computed) continue;
    for (let v = 0; v < position.count; v++)
      for (let c = 0; c < width; c++)
        out[v * width + c] =
          c >= list.itemSize
            ? missing
            : missing
              ? readComponent(geometry, list, v, c)
              : list.getComponent(v, c);
  }
  if (!inBox(next.positions, into.box)) return false;
  if (into.computed) computeNormals(next.positions, index?.array ?? null, next.normals);
  return true;
}
