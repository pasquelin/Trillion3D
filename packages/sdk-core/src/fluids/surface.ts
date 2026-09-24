/**
 * The wave model read at world positions (`waves.ts` displaces rest positions): the height above
 * a point, the rest point under it, and the surface points around a piece of a floating body.
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
export function waveRest(waves: Waves, x: number, z: number, out: Float64Array | number[]) {
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

/**
 * The surface points the rest square `(px ± hx, pz ± hz)` is carried to, into `corners`
 * (`[x, y, z]` of (−,−), (+,−), (−,+), (+,+)), and the height of its centre, returned. By angle
 * addition, each wave costs one sine and cosine for the centre and two for the square's sides.
 */
export function wavePatch(
  waves: Waves,
  px: number,
  pz: number,
  hx: number,
  hz: number,
  corners: Float64Array,
) {
  let y = 0;
  corners.fill(0);
  for (let i = 0; i < waves.count; i++) {
    const dx = waves.dirX[i],
      dz = waves.dirZ[i],
      k = waves.k[i],
      amplitude = waves.amplitude[i],
      lateral = waves.lateral[i];
    const f = k * (dx * px + dz * pz) - waves.phase[i];
    const s = Math.sin(f),
      c = Math.cos(f);
    const sa = Math.sin(k * dx * hx),
      ca = Math.cos(k * dx * hx),
      sb = Math.sin(k * dz * hz),
      cb = Math.cos(k * dz * hz);
    y += amplitude * s;
    for (let corner = 0; corner < 4; corner++) {
      const sx = corner & 1 ? 1 : -1,
        sz = corner & 2 ? 1 : -1;
      const sinD = sx * sa * cb + sz * ca * sb,
        cosD = ca * cb - sx * sz * sa * sb;
      const cosF = c * cosD - s * sinD;
      corners[corner * 3] += lateral * dx * cosF;
      corners[corner * 3 + 1] += amplitude * (s * cosD + c * sinD);
      corners[corner * 3 + 2] += lateral * dz * cosF;
    }
  }
  for (let corner = 0; corner < 4; corner++) {
    corners[corner * 3] += px + (corner & 1 ? hx : -hx);
    corners[corner * 3 + 2] += pz + (corner & 2 ? hz : -hz);
  }
  return y;
}
