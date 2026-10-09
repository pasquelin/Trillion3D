import { NORMAL_Y, OFFSET_X, OFFSET_Z, TERM_COUNT, waveTerms, type Waves } from './waves.ts'

/** Newton iterations of `waveRest`: two leave 1.3 cm at the steepest crests, three 0.3 mm. */
const HEIGHT_ITERATIONS = 3
/** One wave's terms (`waveTerms`), rewritten by each wave of each iteration. */
const terms = new Float64Array(TERM_COUNT)

/** The rest point `[x, ·, z]` the waves carry to the world position `(x, z)`, into `out`; the
 *  physics module runs its C++ print (`scripts/generate-shared-rules.ts`). */
export function waveRest(waves: Waves, x: number, z: number, out: Float64Array | number[]) {
  let px = x,
    pz = z
  for (let n = 0; n < HEIGHT_ITERATIONS; n++) {
    let fx = px - x,
      fz = pz - z,
      sxx = 0,
      sxz = 0,
      szz = 0
    for (let i = 0; i < waves.count; i++) {
      // The wave's lateral offset adds to F; its normal's y term, Qᵢ·Aᵢ·kᵢ·sin fᵢ, scales
      // dᵢ·dᵢᵀ in S.
      waveTerms(waves, i, px, pz, terms)
      const dx = waves.dirX[i],
        dz = waves.dirZ[i],
        qs = terms[NORMAL_Y]
      fx += terms[OFFSET_X]
      fz += terms[OFFSET_Z]
      sxx += qs * dx * dx
      sxz += qs * dx * dz
      szz += qs * dz * dz
    }
    // J = I − S (S symmetric, its eigenvalues ≤ Σ Qᵢ·Aᵢ·kᵢ ≤ 1): p ← p − J⁻¹·F.
    const a = 1 - sxx,
      d = 1 - szz,
      det = a * d - sxz * sxz
    if (!(det > 1e-6)) {
      px -= fx
      pz -= fz
      continue
    }
    px -= (d * fx + sxz * fz) / det
    pz -= (sxz * fx + a * fz) / det
  }
  out[0] = px
  out[2] = pz
  return out
}
