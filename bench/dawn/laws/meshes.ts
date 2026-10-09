// The shapes of the scale laws' generated worlds, as indexed triangle lists, from the engine's own
// geometry (`packages/sdk-core/src/world/geometry`): a latitude–longitude sphere stretched per axis
// for a rock, a capped cylinder standing on the ground (a tower) and a ground grid. Pure: `gltf.ts`
// writes them.
import {
  cylinder as cylinderGeometry,
  plane,
} from '../../../packages/sdk-core/src/world/geometry/basic.ts'
import { sphereArrays } from '../../../packages/sdk-core/src/world/geometry/sphere.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'

export type MeshData = { positions: Float32Array; normals: Float32Array; indices: Uint32Array }

/** A sphere of `rings` latitude bands and `segments` meridians, radii `r` per axis: `2·segments·
 *  (rings − 1)` triangles (the poles' bands are fans). */
export function sphere(r: [number, number, number], segments: number, rings: number): MeshData {
  const unit = sphereArrays([0, 0, 0], 1, segments, rings)
  const positions = new Float32Array(unit.positions.length),
    normals = new Float32Array(unit.normals.length)
  for (let i = 0; i < unit.positions.length; i += 3) {
    const n = unit.normals
    // The normal of an ellipsoid at a point: the point scaled by the inverse squared radii.
    const m = [n[i] / r[0], n[i + 1] / r[1], n[i + 2] / r[2]],
      length = length3(m[0], m[1], m[2])
    for (let k = 0; k < 3; k++) {
      positions[i + k] = n[i + k] * r[k]
      normals[i + k] = m[k] / length
    }
  }
  return { positions, normals, indices: Uint32Array.from(unit.indices) }
}

/** The arrays of an engine geometry, its points moved by `place`, its normals by `turn`. */
function arraysOf(
  geometry: ReturnType<typeof plane>,
  place: (p: Float32Array, at: number) => void,
  turn: (n: Float32Array, at: number) => void = () => {},
): MeshData {
  const positions = Float32Array.from(geometry.attributes.position.array),
    normals = Float32Array.from(geometry.attributes.normal.array)
  for (let at = 0; at < positions.length; at += 3) {
    place(positions, at)
    turn(normals, at)
  }
  return { positions, normals, indices: Uint32Array.from(geometry.index!.array) }
}

/** A cylinder of radius `r` from y = 0 to `height`, `segments` around: `4·segments` triangles. */
export const cylinder = (r: number, height: number, segments: number): MeshData =>
  // The engine's stands on its middle: lifted by half its height onto the ground.
  arraysOf(cylinderGeometry(r, r, height, segments), (p, at) => void (p[at + 1] += height / 2))

/** A flat grid of `side` metres centred on the origin, `cells` a side: `2·cells²` triangles. */
export function ground(side: number, cells: number): MeshData {
  // The engine's plane faces +z: laid on the xz plane, facing +y, `(x, y, z) → (x, z, −y)`.
  const lay = (v: Float32Array, at: number) => {
    const y = v[at + 1]
    v[at + 1] = v[at + 2]
    v[at + 2] = -y
  }
  return arraysOf(plane(side, side, cells, cells), lay, lay)
}

/** A mesh's triangles. */
export const trianglesOf = (mesh: MeshData) => mesh.indices.length / 3
