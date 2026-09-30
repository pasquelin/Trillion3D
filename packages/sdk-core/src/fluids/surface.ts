/**
 * The wave model read at world positions (`waves.ts` displaces rest positions): the height above
 * a point and the rest point under it (the physics module reads the same, `waterPlanes.cpp`).
 */
import type { Waves } from './waves.ts';

/** Newton iterations of `waveRest`: two leave 1.3 cm at the steepest crests, three 0.3 mm. */
const HEIGHT_ITERATIONS = 3;
const scratch = new Float64Array(3);

/**
 * Height of the surface above the world position `(x, z)`. The rest point that lands there
 * solves `p + D(p) = (x, z)`; `HEIGHT_ITERATIONS` Newton steps find it (the Jacobian costs no
 * extra sine), then its height is read. A plain fixed point `p ← (x, z) − D(p)` converges at the
 * rate `Σ Qᵢ·Aᵢ·kᵢ`: near 1, three of its steps leave centimetres (measured on #419).
 */
export function waveHeight(waves: Waves, x: number, z: number) {
  waveRest(waves, x, z, scratch);
  return waves.offset(scratch[0], scratch[2], scratch)[1];
}

/** The rest point `[x, ·, z]` the waves carry to the world position `(x, z)`, into `out`. */
function waveRest(waves: Waves, x: number, z: number, out: Float64Array | number[]) {
  let px = x,
    pz = z;
  for (let n = 0; n < HEIGHT_ITERATIONS; n++) {
    let fx = px - x,
      fz = pz - z,
      sxx = 0,
      sxz = 0,
      szz = 0;
    for (let i = 0; i < waves.count; i++) {
      const dx = waves.dirX[i],
        dz = waves.dirZ[i];
      const f = waves.k[i] * (dx * px + dz * pz) - waves.phase[i];
      const c = Math.cos(f),
        qs = waves.lateral[i] * waves.k[i] * Math.sin(f);
      fx += waves.lateral[i] * dx * c;
      fz += waves.lateral[i] * dz * c;
      sxx += qs * dx * dx;
      sxz += qs * dx * dz;
      szz += qs * dz * dz;
    }
    // J = I − S (S symmetric, its eigenvalues ≤ Σ Qᵢ·Aᵢ·kᵢ ≤ 1): p ← p − J⁻¹·F.
    const a = 1 - sxx,
      d = 1 - szz,
      det = a * d - sxz * sxz;
    if (!(det > 1e-6)) {
      px -= fx;
      pz -= fz;
      continue;
    }
    px -= (d * fx + sxz * fz) / det;
    pz -= (sxz * fx + a * fz) / det;
  }
  out[0] = px;
  out[2] = pz;
  return out;
}
