import { hypot3 } from '../../../../../math/src/float/hypot.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { halton } from '../../../../../math/src/sequence/halton.ts'
import { TAU } from '../../../../../math/src/constants.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'

/**
 * THE CONES OF THE DISTANCE-FIELD OCCLUSION: nine of them over a surface's hemisphere, each covering an equal
 * share of its solid angle, and the sizes of the buffers they are traced into.
 *
 * Everything is traced at a quarter of the resolution of the grid the surfaces' normals and depths are kept in
 * (`CONE_TRACE_DOWNSAMPLE`), itself half of the scene's (`AO_DOWNSAMPLE`); the result is upsampled in two steps
 * (`historyWgsl.ts`, `upsampleWgsl.ts`). The cones' directions are written in the surface's tangent space, the
 * normal their `z`.
 */

/** The scene's pixels, along each side, one pixel of the normals and depths grid stands for. */
export const AO_DOWNSAMPLE = 2
/** The pixels of that grid, along each side, one cone trace stands for. */
export const CONE_TRACE_DOWNSAMPLE = 4
/** The samples along a cone. */
export const CONE_STEPS = 10
/** The cones over a hemisphere. */
export const CONE_DIRECTIONS = 9
/** The side, in pixels of the normals and depths grid, of a tile of the objects' culling and of the threadgroup
 *  of the normals (`GDistanceFieldAOTileSize`). */
export const TILE_SIZE = 16
/** The rings of the low-poly sphere that bounds a mesh (`sphere.ts`): the factor that puts the edges of its faces on
 *  the true sphere follows from them. */
export const BOUNDING_SPHERE_RINGS = 4
/** The cone half angle: each of the nine covers an equal share of the hemisphere's solid angle. */
export const CONE_HALF_ANGLE = Math.acos(1 - 1 / CONE_DIRECTIONS)

/** The sub-pixel offsets, of the cone grid, of the four images the history is built over. */
const JITTER_OFFSETS = [
  [0.25, 0],
  [0.75, 0.25],
  [0.5, 0.75],
  [0, 0.5],
] as const
/** The images over which the cone grid jitters. */
const JITTER_IMAGES = JITTER_OFFSETS.length

/** Sample directions restricted not to intersect the surface they leave, by the cone angle. */
const ORIGINAL_DIRECTIONS = [
  [-0.573257625, 0.625250816, 0.52956301],
  [0.253354192, -0.840093017, 0.479640961],
  [-0.421664953, -0.718063235, 0.553700149],
  [0.249163717, 0.796005428, 0.551627457],
  [0.375082791, 0.29585132, 0.8785128],
  [-0.217619032, 0.00193520682, 0.976031899],
  [-0.852834642, 0.0111727007, 0.522061586],
  [0.74570179, 0.239393353, 0.621787369],
  [-0.151036426, -0.465937436, 0.871831656],
] as const

/** The same, moved apart by repulsion until they settled. */
const RELAXED_DIRECTIONS = [
  [-0.467612, 0.739424, 0.484347],
  [0.517459, -0.70544, 0.484346],
  [-0.419848, -0.767551, 0.484347],
  [0.343077, 0.804802, 0.484347],
  [0.364239, 0.24429, 0.898695],
  [-0.381547, 0.185815, 0.905481],
  [-0.870176, -0.090559, 0.484347],
  [0.874448, 0.02739, 0.484346],
  [0.032967, -0.435625, 0.899524],
] as const

/** The jitter of the cone grid at the image `sampleIndex` (0 to 3), in pixels of the normals grid: the offset
 *  times the trace's downsample factor; none without jitter. */
export function coneGridJitter(sampleIndex: number, useJitter: boolean, useHistory: boolean) {
  if (!useJitter || !useHistory) return [0, 0] as const
  const [x, y] = JITTER_OFFSETS[sampleIndex % JITTER_IMAGES]
  return [x * CONE_TRACE_DOWNSAMPLE, y * CONE_TRACE_DOWNSAMPLE] as const
}

/** The directions of the cones at image `frame`: the set, each turned about the normal by an angle of the
 *  Halton sequence of the frame where the jitter is on. */
export function coneDirections(relaxed: boolean, jitter: boolean, frame: number) {
  const set = relaxed ? RELAXED_DIRECTIONS : ORIGINAL_DIRECTIONS
  const angle = halton(frame & 1023, 2) * TAU
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return set.map(([x, y, z]) =>
    jitter ? ([x * cos - y * sin, x * sin + y * cos, z] as const) : ([x, y, z] as const),
  )
}

/** The factor that brings the sum of the cones' directions, all unoccluded, to unit length (zero where the
 *  sum is nil). */
export function bentNormalNormalizeFactor(directions: readonly (readonly number[])[]) {
  let x = 0
  let y = 0
  let z = 0
  for (const d of directions) {
    x += d[0]
    y += d[1]
    z += d[2]
  }
  const average = hypot3(x, y, z) / directions.length
  return average ? 1 / average : 0
}

/** Writes the directions as `vec4f`s into `out` from word `at` (`CONE_DIRECTIONS` of them). */
export function putConeDirections(
  out: Float32Array,
  at: number,
  directions: readonly (readonly number[])[],
) {
  directions.forEach((d, i) => putVec4(out, at + i * 4, d[0], d[1], d[2]))
}

/** The sizes of the buffers over a scene extent: the normals and depths grid, and the grid the cones are traced on. */
export function occlusionBuffers(extent: readonly [number, number]) {
  const grid = [
    Math.floor(extent[0] / AO_DOWNSAMPLE),
    Math.floor(extent[1] / AO_DOWNSAMPLE),
  ] as const
  const cones = [
    Math.max(Math.floor(grid[0] / CONE_TRACE_DOWNSAMPLE), 1),
    Math.max(Math.floor(grid[1] / CONE_TRACE_DOWNSAMPLE), 1),
  ] as const
  return { grid, cones }
}

/** The tiles, along each side, the objects' culling cuts a view of `width × height` pixels into: its half,
 *  over the tile's side. */
export const tileCounts = (width: number, height: number) =>
  [
    ceilDiv(Math.max(Math.floor(width / AO_DOWNSAMPLE), 1), TILE_SIZE),
    ceilDiv(Math.max(Math.floor(height / AO_DOWNSAMPLE), 1), TILE_SIZE),
  ] as const
