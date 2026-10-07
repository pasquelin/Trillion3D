import { transformAffinePointRowMajor } from '../../../../math/src/vector/vector.ts'
import { PROXY_TRIANGLE_FLOATS } from '../../contracts/proxy.ts'
import { invalidProxy as bad } from './proxyError.ts'

/** Numbers per instance map: three rows of a 3×4 affine matrix, row-major. */
export const PROXY_TRANSFORM_FLOATS = 12

/** The shared part of a proxy file: shapes stored once, and the instances that place them. */
export interface ProxyShapes {
  /** Triangles of each shape, shapes end to end. */
  counts: Uint32Array
  triangles: Float32Array
  albedo: Uint32Array
  /** Shape each instance places, and the map it places it with. */
  shapeOf: Uint32Array
  maps: Float32Array
}

/** Triangles the instances place, each naming a shape that exists; the counts cover the shapes. */
export function placedTriangles(shapes: ProxyShapes): number {
  let stored = 0,
    placed = 0
  for (const count of shapes.counts) {
    if (count === 0) throw bad('A scene proxy shape is empty', {})
    stored += count
  }
  for (const value of shapes.maps)
    if (!Number.isFinite(value)) throw bad('A scene proxy map is non-finite', {})
  if (stored * PROXY_TRIANGLE_FLOATS !== shapes.triangles.length)
    throw bad('The scene proxy shapes do not add up to their triangles', { stored })
  for (const shape of shapes.shapeOf) {
    if (shape >= shapes.counts.length)
      throw bad('A scene proxy instance names a shape it does not have', { shape })
    placed += shapes.counts[shape]
  }
  return placed
}

/**
 * The flat proxy back, triangle for triangle as the compiler simplified it: each instance places
 * its shape at its `positions`, in f64 products and sums rounded once to f32 — the arithmetic the
 * compiler proved bit for bit — and the loose triangles fill the other slots in order.
 */
export function expandShapes(
  total: number,
  shapes: ProxyShapes,
  positions: Uint32Array,
  loose: { triangles: Float32Array; albedo: Uint32Array },
) {
  const triangles = new Float32Array(total * PROXY_TRIANGLE_FLOATS),
    albedo = new Uint32Array(total),
    taken = new Uint8Array(total),
    starts = new Uint32Array(shapes.counts.length)
  for (let shape = 1; shape < starts.length; shape++)
    starts[shape] = starts[shape - 1] + shapes.counts[shape - 1]
  let next = 0
  shapes.shapeOf.forEach((shape, instance) => {
    const m = instance * PROXY_TRANSFORM_FLOATS,
      maps = shapes.maps
    for (let source = starts[shape]; source < starts[shape] + shapes.counts[shape]; source++) {
      const at = positions[next++]
      if (at >= total || taken[at])
        throw bad('A scene proxy instance places a triangle twice or nowhere', { at, instance })
      taken[at] = 1
      albedo[at] = shapes.albedo[source]
      for (let vertex = 0; vertex < PROXY_TRIANGLE_FLOATS; vertex += 3) {
        const from = source * PROXY_TRIANGLE_FLOATS + vertex,
          x = shapes.triangles[from],
          y = shapes.triangles[from + 1],
          z = shapes.triangles[from + 2]
        transformAffinePointRowMajor(
          triangles,
          maps,
          x,
          y,
          z,
          at * PROXY_TRIANGLE_FLOATS + vertex,
          m,
        )
      }
    }
  })
  for (let at = 0, slot = 0; at < total; at++) {
    if (taken[at]) continue
    const from = slot * PROXY_TRIANGLE_FLOATS,
      to = at * PROXY_TRIANGLE_FLOATS
    for (let k = 0; k < PROXY_TRIANGLE_FLOATS; k++) triangles[to + k] = loose.triangles[from + k]
    albedo[at] = loose.albedo[slot++]
  }
  return { triangles, albedo }
}
