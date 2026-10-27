/** An original procedural groom: a few thousand strands rooted on a sphere, each a linear curve of
 *  eight points that runs out along the sphere's normal and bends down, its width tapering from the root
 *  to the tip; and the scalp, a sphere just under their roots. No downloaded geometry, no groom asset.
 *  Everything is deterministic: positions in metres, from the strand's rank alone. */
export const STRAND_COUNT = 4096
export const POINTS_PER_STRAND = 8
export const HEAD_RADIUS = 0.5
/** The strands' length before the draw of each strand scales it by 0.8 to 1.2. */
export const STRAND_LENGTH = 0.3
export const ROOT_WIDTH = 0.002
export const TIP_WIDTH = 0.0005
/** How far, over its length, the tip of a strand sags. */
const DROOP = 0.12
/** The sideways wander of a tip, at most. */
const WANDER = 0.05
const SCALP_RINGS = 16
const SCALP_SEGMENTS = 32
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** A number in [0, 1) from a rank and a salt: a 32-bit integer hash, so no platform draws another. */
export function unit(rank: number, salt: number) {
  let h = Math.imul(rank ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export interface HairStrandsExample {
  /** The points of each strand: eight, `POINTS_PER_STRAND`. */
  readonly counts: number[]
  /** `x, y, z` of every point, strand after strand. */
  readonly points: number[]
  /** The width of every point. */
  readonly widths: number[]
  /** The scalp, a sphere of triangles: its points, the normals at them and the corner indices. */
  readonly scalp: { points: number[]; normals: number[]; indices: number[] }
}

/** The strands: roots spread on the sphere by the golden angle, a strand's tip drawn out of its
 *  rank. */
function strands() {
  const counts: number[] = [],
    points: number[] = [],
    widths: number[] = []
  for (let i = 0; i < STRAND_COUNT; i++) {
    const y = 1 - (2 * (i + 0.5)) / STRAND_COUNT,
      r = Math.sqrt(1 - y * y),
      angle = i * GOLDEN_ANGLE
    const direction = [r * Math.cos(angle), y, r * Math.sin(angle)]
    const length = STRAND_LENGTH * (0.8 + 0.4 * unit(i, 1))
    const wander = [(unit(i, 2) - 0.5) * WANDER, 0, (unit(i, 3) - 0.5) * WANDER]
    counts.push(POINTS_PER_STRAND)
    for (let k = 0; k < POINTS_PER_STRAND; k++) {
      const t = k / (POINTS_PER_STRAND - 1)
      for (let axis = 0; axis < 3; axis++) {
        const root = direction[axis]! * HEAD_RADIUS + (axis === 1 ? HEAD_RADIUS : 0)
        points.push(
          root +
            direction[axis]! * length * t +
            wander[axis]! * t * t -
            (axis === 1 ? DROOP * t * t : 0),
        )
      }
      widths.push(ROOT_WIDTH + (TIP_WIDTH - ROOT_WIDTH) * t)
    }
  }
  return { counts, points, widths }
}

/** The scalp: a pole at the top, `SCALP_RINGS - 1` rings of `SCALP_SEGMENTS` points, a pole at the
 *  bottom, in triangles wound counterclockwise seen from outside. */
function scalp() {
  const radius = HEAD_RADIUS * 0.98
  const points: number[] = [],
    normals: number[] = [],
    indices: number[] = []
  const vertex = (x: number, y: number, z: number) => {
    normals.push(x, y, z)
    points.push(x * radius, y * radius + HEAD_RADIUS, z * radius)
  }
  vertex(0, 1, 0)
  for (let ring = 1; ring < SCALP_RINGS; ring++) {
    const theta = (Math.PI * ring) / SCALP_RINGS
    for (let s = 0; s < SCALP_SEGMENTS; s++) {
      const phi = (2 * Math.PI * s) / SCALP_SEGMENTS
      vertex(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi))
    }
  }
  vertex(0, -1, 0)
  const at = (ring: number, s: number) => 1 + (ring - 1) * SCALP_SEGMENTS + (s % SCALP_SEGMENTS)
  const south = points.length / 3 - 1
  for (let s = 0; s < SCALP_SEGMENTS; s++) {
    indices.push(0, at(1, s + 1), at(1, s))
    for (let ring = 1; ring < SCALP_RINGS - 1; ring++) {
      const a = at(ring, s),
        b = at(ring, s + 1),
        c = at(ring + 1, s + 1),
        d = at(ring + 1, s)
      indices.push(a, b, c, a, c, d)
    }
    indices.push(south, at(SCALP_RINGS - 1, s), at(SCALP_RINGS - 1, s + 1))
  }
  return { points, normals, indices }
}

/** The example: `STRAND_COUNT` strands on a sphere of `HEAD_RADIUS`, the scalp under them. */
export const hairStrandsExample = (): HairStrandsExample => ({ ...strands(), scalp: scalp() })
