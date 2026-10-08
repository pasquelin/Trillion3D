import { length3, normalizeVector3 } from '../../../../math/src/vector/vector.ts'
import { computeNormals } from './normals.ts'
import { GeometryBuilder } from './builder.ts'
import type { Geometry } from './geometry.ts'
import { edgesOf } from './lines.ts'
import type { Primitive } from '../object/mesh.ts'
import { drawnSprite } from './drawnSprite.ts'
import { POINT_VERTICES, points } from './drawnPoints.ts'
import { flatten } from './drawnFlat.ts'
import { deforms, drawnDeformation, type DrawnDeformation } from './drawnDeformation.ts'
import { readPoints, readsStored } from './bounds.ts'
/** The triangles a mesh draws, as the page cutter reads them. `lines` says they are line quads
 *  (`quads`), which every raster widens on screen by the surface's `lineWidth`; a dashed line's
 *  quads carry their distance along the line in the first coordinate of `uvs`. */
export interface DrawnTriangles {
  sourceVertices?: Uint32Array
  deformation?: DrawnDeformation
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array | null
  colors: Float32Array | null
  indices: Uint32Array
  lines?: boolean
  /** Set on a sprite's quad (`drawnSprite`): its farthest corner from the sprite's origin. */
  spriteRadius?: number
}
type V3 = [number, number, number]
/** The material and object fields that change what a mesh draws (`drawnTriangles`). */
type DrawnOptions = {
  size?: number
  wireframe?: boolean
  flat?: boolean
  dashed?: boolean
  center?: readonly [number, number]
}
/**
 * What a mesh draws, as triangles: the engine rasterises triangles alone, so a point is a small
 * octahedron of the material's `size` and a line segment a quad of two triangles whose corners
 * all sit on the segment (`quads`). A line has no width in world units: the rasters widen each
 * quad on screen to the surface's `lineWidth` in CSS pixels, at every distance
 * (`sdk-browser/src/visibility/shader/lineWgsl.ts`). A `dashed` line's quads also carry the
 * distance along the line of each corner, which the rasters cut into dashes and gaps.
 */
function drawTriangles(
  geometry: Geometry,
  reading: Primitive,
  options: DrawnOptions = {},
): DrawnTriangles | null {
  if (reading === 'sprite')
    return drawnSprite(drawnTriangles(geometry, 'triangles'), options.center)
  const traced = deforms(geometry)
  const position = geometry.attributes.position
  if (!position || position.count === 0) return null
  const p = Array.from(readPoints(position))
  const corners = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from({ length: position.count }, (_, i) => i)
  if (reading === 'points') {
    const drawn = solids(points(p, (options.size ?? 1) / 2))
    if (drawn && traced)
      drawn.sourceVertices = Uint32Array.from({ length: drawn.positions.length / 3 }, (_, v) =>
        Math.floor(v / POINT_VERTICES),
      )
    return drawn
  }
  if (reading === 'lineStrip' || reading === 'lineLoop' || reading === 'lineSegments') {
    const loop = reading === 'lineLoop' && corners.length > 2
    return quads(p, lineCorners(corners, reading), traced, options.dashed, loop)
  }
  if (corners.length < 3) return null
  if (options.wireframe) {
    // Every edge once, however many triangles share it (`edgesOf`).
    const segments = [...edgesOf(geometry).values()].flatMap(({ a, b }) => [a, b])
    return quads(p, segments, traced, options.dashed)
  }
  const drawn = {
    positions: new Float32Array(p),
    normals: readList(geometry, 'normal', 3, position.count),
    uvs: readList(geometry, 'uv', 2, position.count),
    colors: readList(geometry, 'color', 4, position.count),
    indices: new Uint32Array(corners.slice(0, corners.length - (corners.length % 3))),
  }
  if (options.flat) return flatten(drawn, traced)
  return { ...drawn, normals: drawn.normals ?? computeNormals(drawn.positions, drawn.indices) }
}
/** Drawn triangles with their original deformation attributes preserved. */
export function drawnTriangles(geometry: Geometry, reading: Primitive, options: DrawnOptions = {}) {
  return drawnDeformation(geometry, drawTriangles(geometry, reading, options))
}
/** List `name` of `g`, `width` numbers for each of its first `n` vertices as the page
 *  cutter reads them, a missing component 1: into `out` when given; null when it holds fewer. */
export function readList(g: Geometry, name: string, width: number, n: number, out?: Float32Array) {
  const a = g.attributes[name]
  if (!a || a.count < n) return null
  out ??= new Float32Array(n * width)
  return a.readInto(out, 0, width, 0, n, width, 1, readsStored(g, a))
}

/** The segments a line reading draws, as `[a, b]` corner pairs: each pair of `lineSegments`,
 *  each step of `lineStrip`, and `lineLoop` closed from its last corner back to its first. */
export function lineCorners(
  corners: readonly number[],
  reading: 'lineSegments' | 'lineStrip' | 'lineLoop',
) {
  const segments: number[] = []
  const step = reading === 'lineSegments' ? 2 : 1
  for (let i = 0; i + 1 < corners.length; i += step) segments.push(corners[i], corners[i + 1])
  if (reading === 'lineLoop' && corners.length > 2)
    segments.push(corners[corners.length - 1], corners[0])
  return segments
}

/** Two triangles per segment; normal signs widen endpoints on screen, UVs retain dash distance. */
function quads(
  p: number[],
  segments: number[],
  traced: boolean,
  dashed = false,
  loop = false,
): DrawnTriangles | null {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    sourceVertices: number[] = []
  let distance = 0
  for (let s = 0; s + 1 < segments.length; s += 2) {
    const a = segments[s] * 3,
      b = segments[s + 1] * 3
    const d: V3 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
    const length = length3(d[0], d[1], d[2])
    if (length === 0) continue
    normalizeVector3(d)
    const first = positions.length / 3
    const end = loop && s + 2 === segments.length ? 0 : distance + length
    for (const [at, side] of [
      [a, 1],
      [a, -1],
      [b, 1],
      [b, -1],
    ]) {
      if (traced) sourceVertices.push(at / 3)
      positions.push(p[at], p[at + 1], p[at + 2])
      normals.push(d[0] * side, d[1] * side, d[2] * side)
      if (dashed) uvs.push(at === a ? distance : end, 0)
    }
    distance += length
    indices.push(first, first + 1, first + 3, first, first + 3, first + 2)
  }
  if (!indices.length) return null
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: dashed ? new Float32Array(uvs) : null,
    colors: null,
    indices: new Uint32Array(indices),
    lines: true,
    ...(traced && { sourceVertices: new Uint32Array(sourceVertices) }),
  }
}

/** A builder's triangles as drawn arrays. */
function solids(b: GeometryBuilder): DrawnTriangles | null {
  if (!b.indices.length) return null
  return {
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    uvs: null,
    colors: null,
    indices: new Uint32Array(b.indices),
  }
}
