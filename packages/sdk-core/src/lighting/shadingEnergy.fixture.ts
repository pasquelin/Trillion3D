// The GGX energy table built sample by sample (`shadingEnergy.ts` holds its column along the normal as data, which the test of
// that file checks against this builder bit for bit).
import { TAU } from '../../../math/src/constants.ts'
import { halton } from '../../../math/src/sequence/halton.ts'
import { SHADING_ENERGY_SIZE } from './shadingEnergy.ts'

/** Points of the net a texel is the mean of. */
export const SHADING_ENERGY_SAMPLES = 1 << 14
/** The least roughness a lobe is built with. */
const MIN_ROUGHNESS = 0.01

/**
 * The texel of the table for the view cosine `noV` and the roughness `roughness`: `[E, Ef]`, the means over `samples`
 * points. The view lies in the xz plane, the lobe round.
 */
export function shadingEnergyTexel(
  noV: number,
  roughness: number,
  samples = SHADING_ENERGY_SAMPLES,
): readonly [number, number] {
  const vz = Math.max(noV, 1e-8)
  const vx = Math.sqrt(Math.max(1 - vz * vz, 0))
  const alpha = Math.max(roughness, MIN_ROUGHNESS) ** 2
  // The view in the frame where the lobe is stretched to a hemisphere, and its length there.
  const lenV = Math.hypot(vx * alpha, vz)
  const stretchedX = (vx * alpha) / lenV
  const stretchedZ = vz / lenV
  // The range of normals the sampling keeps to those whose reflection can stay above the horizon (the bound k).
  const s2 = (1 + vx) ** 2
  const a2 = alpha * alpha
  const bound = (s2 - a2 * s2) / (s2 + a2 * vz * vz)
  let energy = 0
  let fresnelEnergy = 0
  for (let i = 0; i < samples; i++) {
    const phi = TAU * (i / samples)
    const z = 1 + (-bound * stretchedZ - 1) * halton(i, 2)
    const sine = Math.sqrt(Math.min(Math.max(1 - z * z, 0), 1))
    // The cap's point added to the stretched view, then unstretched.
    let hx = sine * Math.cos(phi) + stretchedX
    let hy = sine * Math.sin(phi)
    let hz = Math.max(0, z + stretchedZ)
    hx *= alpha
    hy *= alpha
    const hLength = Math.hypot(hx, hy, hz)
    hx /= hLength
    hy /= hLength
    hz /= hLength
    const vDotH = vx * hx + vz * hz
    const lx = 2 * vDotH * hx - vx
    const ly = 2 * vDotH * hy
    const lz = 2 * vDotH * hz - vz
    if (lz <= 0) continue
    const noL = Math.min(lz, 1)
    const lenL = Math.hypot(lx * alpha, ly * alpha, noL)
    const weight = (noL * (lenV + bound * vz)) / (vz * lenL + noL * lenV)
    energy += weight
    fresnelEnergy += weight * (1 - vDotH) ** 5
  }
  return [energy / samples, fresnelEnergy / samples]
}

/**
 * The column of the table a view along the normal reads, built: N·V of one, which the clamped sampler takes at the centre of
 * the last texel across. `SHADING_ENERGY_SIZE` pairs `[E, Ef]`, row after row, roughness rising.
 */
export function shadingEnergyAlongNormal(samples = SHADING_ENERGY_SAMPLES) {
  const noV = (SHADING_ENERGY_SIZE - 0.5) / SHADING_ENERGY_SIZE
  const column = new Float32Array(SHADING_ENERGY_SIZE * 2)
  for (let row = 0; row < SHADING_ENERGY_SIZE; row++)
    column.set(shadingEnergyTexel(noV, (row + 0.5) / SHADING_ENERGY_SIZE, samples), row * 2)
  return column
}
