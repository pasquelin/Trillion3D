// Where a generated open world places its objects: `count` of them at one density, over a square
// whose area grows with the count, so the world reaches farther to the horizon as it grows while a
// view's near field stays the same. Each object is one of the kinds, by its share, at a seeded
// position, turn and size: the same world on every run. Pure.

import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
/** A kind of object: its share of the world's objects and its size range (a scale factor). */
export type Kind = { name: string; share: number; scale: [number, number] }

/** The open world's kinds: small dense pebbles, rocks, and towers seen from far. */
export const KINDS: readonly Kind[] = [
  { name: 'pebble', share: 0.6, scale: [0.6, 1.6] },
  { name: 'rock', share: 0.3, scale: [0.5, 1.5] },
  { name: 'tower', share: 0.1, scale: [0.6, 1.4] },
]

/** Objects a square metre: one every 4 m². */
export const DENSITY = 0.25

/** The side, metres, of the square holding `count` objects at `density`. */
export const sideOf = (count: number, density = DENSITY) => Math.sqrt(count / density)

/** One kind's placements: x, y, z a placement, a quaternion about y, and a uniform scale. */
export type Placements = {
  translations: Float32Array
  rotations: Float32Array
  scales: Float32Array
}

/** The placements of `count` objects over the square of `sideOf(count)`, kind by kind: every kind
 *  holds the integer part of its share, the remainder going to the first. */
export function scatter(count: number, kinds = KINDS, seed = 7): Placements[] {
  const side = sideOf(count)
  // The lcg32 sequence, a zero seed taken as one (`lcgRandom`).
  const next = lcgRandom(seed || 1)
  const counts = kinds.map((kind) => Math.floor(kind.share * count))
  counts[0] += count - counts.reduce((a, b) => a + b, 0)
  return kinds.map((kind, k) => {
    const n = counts[k]
    const translations = new Float32Array(3 * n),
      rotations = new Float32Array(4 * n),
      scales = new Float32Array(3 * n)
    for (let i = 0; i < n; i++) {
      translations.set([(next() - 0.5) * side, 0, (next() - 0.5) * side], 3 * i)
      const half = next() * Math.PI
      rotations.set([0, Math.sin(half), 0, Math.cos(half)], 4 * i)
      const s = kind.scale[0] + next() * (kind.scale[1] - kind.scale[0])
      scales.set([s, s, s], 3 * i)
    }
    return { translations, rotations, scales }
  })
}
