import { isSkinIndex, skinStreams } from './skin.ts'
import type { Geometry } from './geometry.ts'
import type { DrawnTriangles } from './drawn.ts'
import { readComponent } from './bounds.ts'

/** Source attributes follow the same vertex permutation as the raster's drawn triangles. */
export type DrawnDeformation = {
  influences?: number
  joints?: Float32Array
  weights?: Float32Array
  targets: { positions: Float32Array; normals: Float32Array }[]
}

/** Whether `g` carries a skin or morph targets: only then does a drawn vertex keep which source
 *  vertex it came from (`DrawnTriangles.sourceVertices`). */
export const deforms = (g: Geometry) =>
  !!g.morphAttributes.position?.length || Object.keys(g.attributes).some(isSkinIndex)

/** How far morph target `t` of `g` moves component `c` of source vertex `vertex`: its position's
 *  delta, or its normal's (`normal`) — 0 for a target without normals —, read as `g` stores its
 *  targets, relative or absolute (`morphTargetsRelative`). The one read of a target's delta: the
 *  drawn triangles take it. */
function morphDelta(g: Geometry, t: number, vertex: number, c: number, normal: boolean) {
  const target = (normal ? g.morphAttributes.normal : g.morphAttributes.position)?.[t]
  if (!target) return 0
  const base = normal ? g.attributes.normal : g.attributes.position
  const rest = g.morphTargetsRelative || !base ? 0 : readComponent(g, base, vertex, c)
  return readComponent(g, target, vertex, c) - rest
}

/** Setup-time extraction only: animation uploads palettes and weights, never these vertices. */
export function drawnDeformation(g: Geometry, drawn: DrawnTriangles | null) {
  if (!drawn) return null
  const count = drawn.positions.length / 3
  const source = (v: number) => drawn.sourceVertices?.[v] ?? v
  const skin = skinStreams(g)
  const list = (weight: boolean) => {
    if (!skin.width) return undefined
    const result = new Float32Array(count * skin.width)
    for (let v = 0; v < count; v++)
      for (let c = 0; c < skin.width; c++)
        result[v * skin.width + c] = skin.read(source(v), c, weight)
    return result
  }
  const targets = (g.morphAttributes.position ?? []).map((_, target) => {
    const positions = new Float32Array(count * 3),
      normals = new Float32Array(count * 3)
    for (let v = 0; v < count; v++) {
      const vertex = source(v)
      for (let c = 0; c < 3; c++) {
        positions[v * 3 + c] = morphDelta(g, target, vertex, c, false)
        normals[v * 3 + c] = morphDelta(g, target, vertex, c, true)
      }
    }
    return { positions, normals }
  })
  const joints = list(false),
    weights = list(true)
  if ((joints && weights) || targets.length)
    drawn.deformation = { joints, weights, targets, influences: skin.width }
  return drawn
}
