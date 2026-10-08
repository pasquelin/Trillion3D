// The shapes of the aerial scene (`aerial.ts`): a rolling ground in square tiles, and the
// few props thousands of nodes share — trees, houses, rocks — each turned on the lathe from a
// profile, so a triangle count is asked of it and reached. Every mesh is indexed, with smooth
// normals; the ground's tiles read one height function, so two neighbours meet without a seam.
import type { Random } from '../../../site/examples/kit/random.ts'
import { computeNormals } from '../../../packages/sdk-core/src/world/geometry/normals.ts'
import { TAU } from '../../../packages/math/src/constants.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'

export interface ShapeMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

/** Height of the ground at `x`, `z` (metres): three octaves of sines, from 0 to `relief`. */
export function groundHeight(x: number, z: number, relief: number) {
  const wave = (scale: number, phase: number) =>
    Math.sin(x / scale + phase) * Math.cos(z / (scale * 1.3) - phase)
  return relief * (0.5 + 0.28 * wave(610, 0.4) + 0.15 * wave(230, 1.7) + 0.07 * wave(83, 2.9))
}

/** A square grid of `cells`² quads, two triangles each, counter-clockwise seen from +y. */
function gridIndices(cells: number) {
  const indices = new Uint32Array(cells * cells * 6),
    row = cells + 1
  let at = 0
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const v = j * row + i
      indices.set([v, v + row, v + 1, v + 1, v + row, v + row + 1], at)
      at += 6
    }
  return indices
}

/** One ground tile of side `size`, its corner at `x0`, `z0`, in local coordinates from there. */
export function groundTile(x0: number, z0: number, size: number, cells: number, relief: number) {
  const row = cells + 1,
    positions = new Float32Array(row * row * 3),
    normals = new Float32Array(row * row * 3),
    step = size / cells,
    slope = step / 2
  for (let j = 0; j < row; j++)
    for (let i = 0; i < row; i++) {
      const [x, z] = [x0 + i * step, z0 + j * step],
        v = (j * row + i) * 3
      positions.set([i * step, groundHeight(x, z, relief), j * step], v)
      // The normal from the height function itself, so a shared edge has one normal on both tiles.
      const dx = groundHeight(x + slope, z, relief) - groundHeight(x - slope, z, relief),
        dz = groundHeight(x, z + slope, relief) - groundHeight(x, z - slope, relief),
        length = length3(dx, 2 * slope, dz)
      normals.set([-dx / length, (2 * slope) / length, -dz / length], v)
    }
  return { positions, normals, indices: gridIndices(cells) }
}

/**
 * The surface of revolution of `profile` (radius, height pairs, bottom to top) around +y, in
 * `segments` sides, each span of the profile cut into `rings` bands: 2 × segments × bands
 * triangles. `wobble` moves each vertex's radius by up to that share, from `random`.
 */
export function lathe(
  profile: [number, number][],
  segments: number,
  rings: number,
  random?: Random,
  wobble = 0,
): ShapeMesh {
  const points: [number, number][] = []
  for (let p = 0; p + 1 < profile.length; p++)
    for (let r = 0; r < rings; r++) {
      const t = r / rings,
        [a, b] = [profile[p], profile[p + 1]]
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  points.push(profile[profile.length - 1])
  const row = segments + 1,
    positions = new Float32Array(points.length * row * 3)
  for (const [j, [radius, height]] of points.entries())
    for (let i = 0; i < row; i++) {
      const angle = ((i % segments) / segments) * TAU,
        r = radius * (1 + (random && i < segments ? (random() - 0.5) * 2 * wobble : 0))
      positions.set([Math.cos(angle) * r, height, -Math.sin(angle) * r], (j * row + i) * 3)
    }
  // The seam's last column repeats the first one's radius, so the surface closes.
  for (let j = 0; j < points.length; j++)
    for (const k of [0, 2]) positions[(j * row + segments) * 3 + k] = positions[j * row * 3 + k]
  const indices = new Uint32Array((points.length - 1) * segments * 6)
  let at = 0
  for (let j = 0; j + 1 < points.length; j++)
    for (let i = 0; i < segments; i++) {
      const v = j * row + i
      indices.set([v, v + 1, v + row, v + 1, v + row + 1, v + row], at)
      at += 6
    }
  return { positions, normals: computeNormals(positions, indices), indices }
}

/** The props a node may carry: a name, a lathe profile, and its sides and bands. */
export interface PropShape {
  name: string
  material: number
  profile: [number, number][]
  segments: number
  rings: number
  wobble: number
  /** Relative share of the scattered nodes that carry it. */
  share: number
}

/** Radius, height pairs, bottom to top, from a flat list. */
const pairs = (...values: number[]) =>
  values.flatMap((value, i) => (i % 2 ? [] : [[value, values[i + 1]] as [number, number]]))

/** Five props, from ~2 k to ~30 k triangles each, like a world's trees, houses and rocks. */
export const PROPS: PropShape[] = [
  {
    name: 'pine',
    material: 1,
    profile: pairs(0.3, 0, 0.3, 2, 3, 2.2, 0.8, 7, 2.4, 7.2, 0.4, 12, 0, 13),
    segments: 64,
    rings: 16,
    wobble: 0.08,
    share: 4,
  },
  {
    name: 'oak',
    material: 1,
    profile: pairs(0.4, 0, 0.4, 3, 3.5, 4, 4.5, 7, 3, 10, 0, 11),
    segments: 96,
    rings: 24,
    wobble: 0.12,
    share: 2,
  },
  {
    name: 'bush',
    material: 1,
    profile: pairs(0.1, 0, 1.4, 0.4, 1.6, 1.2, 0, 2),
    segments: 40,
    rings: 12,
    wobble: 0.15,
    share: 3,
  },
  {
    name: 'house',
    material: 2,
    profile: pairs(5, 0, 5, 6, 5.6, 6, 0, 10),
    segments: 4,
    rings: 64,
    wobble: 0,
    share: 1,
  },
  {
    name: 'rock',
    material: 3,
    profile: pairs(0.1, -0.5, 2.2, 0.3, 1.8, 1.6, 0, 2.2),
    segments: 64,
    rings: 24,
    wobble: 0.2,
    share: 1,
  },
]
