// The shapes of the scale laws' generated worlds, as indexed triangle lists: a UV sphere (stretched
// per axis for a rock), a capped cylinder (a tower) and a ground grid. Pure: `gltf.ts` writes them.

import { TAU } from '../../../packages/math/src/constants.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'

export type MeshData = { positions: Float32Array; normals: Float32Array; indices: Uint32Array }

/** A sphere of `rings` latitude bands and `segments` meridians, radii `r` per axis: `2·segments·
 *  (rings − 1)` triangles (the poles' bands are fans). */
export function sphere(r: [number, number, number], segments: number, rings: number): MeshData {
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = []
  for (let i = 0; i <= rings; i++) {
    const theta = (i / rings) * Math.PI
    for (let j = 0; j <= segments; j++) {
      const phi = (j / segments) * TAU
      const n = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]
      positions.push(n[0] * r[0], n[1] * r[1], n[2] * r[2])
      // The normal of an ellipsoid at a point: the point scaled by the inverse squared radii.
      const m = [n[0] / r[0], n[1] / r[1], n[2] / r[2]]
      const length = length3(m[0], m[1], m[2])
      normals.push(m[0] / length, m[1] / length, m[2] / length)
    }
  }
  const row = segments + 1
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segments; j++) {
      const a = i * row + j,
        b = a + row
      if (i > 0) indices.push(a, a + 1, b)
      if (i < rings - 1) indices.push(a + 1, b + 1, b)
    }
  return pack(positions, normals, indices)
}

/** A cylinder of radius `r` from y = 0 to `height`, `segments` around: `4·segments` triangles. */
export function cylinder(r: number, height: number, segments: number): MeshData {
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = []
  const vertex = (p: number[], n: number[]) => (
    positions.push(...p),
    normals.push(...n),
    positions.length / 3 - 1
  )
  for (let j = 0; j < segments; j++) {
    const a = (j / segments) * TAU,
      b = ((j + 1) / segments) * TAU
    const side = [a, b].map((t) => [Math.cos(t), 0, Math.sin(t)])
    const [p, q] = side.map((n) => vertex([n[0] * r, 0, n[2] * r], n))
    const [s, t] = side.map((n) => vertex([n[0] * r, height, n[2] * r], n))
    indices.push(p, s, q, q, s, t)
    const top = vertex([0, height, 0], [0, 1, 0]),
      bottom = vertex([0, 0, 0], [0, -1, 0])
    const [u, v] = side.map((n) => vertex([n[0] * r, height, n[2] * r], [0, 1, 0]))
    const [w, x] = side.map((n) => vertex([n[0] * r, 0, n[2] * r], [0, -1, 0]))
    indices.push(top, v, u, bottom, w, x)
  }
  return pack(positions, normals, indices)
}

/** A flat grid of `side` metres centred on the origin, `cells` a side: `2·cells²` triangles. */
export function ground(side: number, cells: number): MeshData {
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = []
  for (let i = 0; i <= cells; i++)
    for (let j = 0; j <= cells; j++) {
      positions.push((j / cells - 0.5) * side, 0, (i / cells - 0.5) * side)
      normals.push(0, 1, 0)
    }
  const row = cells + 1
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) {
      const a = i * row + j
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1)
    }
  return pack(positions, normals, indices)
}

const pack = (positions: number[], normals: number[], indices: number[]): MeshData => ({
  positions: new Float32Array(positions),
  normals: new Float32Array(normals),
  indices: new Uint32Array(indices),
})

/** A mesh's triangles. */
export const trianglesOf = (mesh: MeshData) => mesh.indices.length / 3
