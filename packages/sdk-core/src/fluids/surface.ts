/**
 * The wave model read at world positions (`waves.ts` displaces rest positions): the height above
 * a point and the rest point under it (the physics module reads the same, `waterPlanes.cpp`).
 */
import type { Waves } from './waves.ts'
import { waveRest } from './waveRest.ts'
const scratch = new Float64Array(3)

/**
 * Height of the surface above the world position `(x, z)`. The rest point that lands there
 * solves `p + D(p) = (x, z)`; `HEIGHT_ITERATIONS` Newton steps find it (the Jacobian costs no
 * extra sine), then its height is read. A plain fixed point `p ← (x, z) − D(p)` converges at the
 * rate `Σ Qᵢ·Aᵢ·kᵢ`: near 1, three of its steps leave centimetres (measured on #419).
 */
export function waveHeight(waves: Waves, x: number, z: number) {
  waveRest(waves, x, z, scratch)
  return waves.offset(scratch[0], scratch[2], scratch)[1]
}
