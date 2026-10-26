import { readList, type DrawnTriangles } from '../../../../../sdk-core/src/world/geometry/drawn.ts'
import type { Geometry } from '../../../../../sdk-core/src/world/geometry/geometry.ts'
import type { Primitive } from '../../../../../sdk-core/src/world/object/mesh.ts'
import { computeNormals } from '../../../../../sdk-core/src/world/geometry/normals.ts'
import { boxExpandByPoint, boxFromPoints, boxGrow } from '../../../../../math/src/geometry/box.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import type { HeldBox } from '../../../geometry/runtime/runtimePrimitive.ts'
import { LISTS } from './dynamicRanges.ts'

/** The drawn box of `drawn`, joined to `declared` and `before`; widened by half its size when
 *  nothing was declared, so that a sheet that waves stays within the box it was cut in. */
export function heldBox(drawn: DrawnTriangles, declared: Geometry['maxBounds'], before?: HeldBox) {
  const box = new Float64Array(6),
    p = drawn.positions
  boxFromPoints(box, 0, p, 0, Math.floor(p.length / 3))
  for (const c of declared ? [declared.min, declared.max] : [])
    boxExpandByPoint(box, 0, c.x, c.y, c.z)
  for (let k = 0; before && k < 6; k += 3)
    boxExpandByPoint(box, 0, before[k], before[k + 1], before[k + 2])
  const pad = declared ? 0 : Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2], 1e-3) / 2
  boxGrow(box, 0, box, 0, pad)
  return box
}

/** Whether `next` draws the triangles `held` draws — the same corners, the same lists —, and
 *  within `box`: its vertices can then be written in place. */
export function fits(held: DrawnTriangles, next: DrawnTriangles, box: HeldBox) {
  if (!sameValues(held.indices, next.indices)) return false
  for (const [list] of LISTS) if (held[list]?.length !== next[list]?.length) return false
  return inBox(next.positions, box)
}

/** Whether every point of `p`, three numbers each, lies within `box`. */
function inBox(p: ArrayLike<number>, box: ArrayLike<number>) {
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i],
      y = p[i + 1],
      z = p[i + 2]
    if (x < box[0] || x > box[3] || y < box[1] || y > box[4] || z < box[2] || z > box[5])
      return false
  }
  return true
}

/** What a dynamic resource reads each rewrite into: lists of its own, and the index its corners
 * came from, at its version, within the drawn range. */
export type Reading = {
  next: DrawnTriangles
  index: Geometry['index']
  indexVersion: number
  range: readonly [number, number]
}

/** The reading of `geometry`, first drawn as `drawn`: a copy of each of its lists. */
export function readingOf({ index, drawRange }: Geometry, drawn: DrawnTriangles): Reading {
  const [positions, normals, uvs, colors] = LISTS.map(([list]) => drawn[list]?.slice() ?? null)
  return {
    next: { ...drawn, positions: positions!, normals: normals!, uvs, colors },
    index,
    indexVersion: index?.version ?? 0,
    range: [drawRange.start, drawRange.count],
  }
}

/** Whether `geometry` still draws the corners `into` was cut from, as plain triangles: the same
 *  index, draw range and vertex count. */
function keepsCorners(
  geometry: Geometry,
  reading: Primitive,
  options: { wireframe?: boolean; flat?: boolean },
  into: Reading,
) {
  const { next } = into,
    { position } = geometry.attributes,
    index = geometry.index
  if (reading !== 'triangles' || options.wireframe || options.flat || next.lines) return false
  if (index !== into.index || (index?.version ?? 0) !== into.indexVersion) return false
  const { start, count } = geometry.drawRange
  if (start !== into.range[0] || count !== into.range[1]) return false
  return !!position && position.count * 3 === next.positions.length
}

/** Every list after the positions as `drawnTriangles` reads it, into `next`; false where one
 *  cannot be read in place. */
function readLists(geometry: Geometry, count: number, next: DrawnTriangles) {
  for (let l = 1; l < LISTS.length; l++) {
    const [field, name, width] = LISTS[l],
      out = next[field]
    if (!out && (geometry.attributes[name]?.count ?? -1) >= count) return false
    if (out && !readList(geometry, name, width, count, out) && field !== 'normals') return false
  }
  return true
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
    { position, normal } = geometry.attributes
  if (!position || !keepsCorners(geometry, reading, options, into)) return false
  position.readInto(next.positions, 0, 3, 0, position.count, 3, 0)
  // Missing normals are made below.
  if (!readLists(geometry, position.count, next)) return false
  if (!inBox(next.positions, into.box)) return false
  if (!normal || normal.count < position.count)
    computeNormals(next.positions, next.indices, next.normals)
  return true
}
