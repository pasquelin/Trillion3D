// Lamp-shadow oracle, rewritten from the contracts: the world-space sphere of a cluster in eight
// floats since 16729c858f — the transformed box centre as three split doubles (rounded high part
// at `base`, what it left at `base + 4`), the radius inflated term by term, then widened by the
// centre's own split error and rounded UP to f32, so the sphere stays conservative.
export const SPHERE_FLOATS = 8;

const f32 = new Float32Array(1),
  f32Bits = new Uint32Array(f32.buffer);

/** The smallest f32 at or above `v` (`v` finite and not negative, as a radius is). */
function f32AtOrAbove(v: number) {
  f32[0] = v;
  if (f32[0] < v) f32Bits[0]++;
  return f32[0];
}

export function referenceClusterSphere(
  {
    matrix: { elements: e },
    min,
    max,
  }: { matrix: { elements: ArrayLike<number> } } & {
    min: number[];
    max: number[];
  },
  out: Float32Array,
  base: number,
) {
  const mx = (min[0] + max[0]) / 2,
    my = (min[1] + max[1]) / 2,
    mz = (min[2] + max[2]) / 2;
  const hx = (max[0] - min[0]) / 2,
    hy = (max[1] - min[1]) / 2,
    hz = (max[2] - min[2]) / 2;
  const centre = [
    e[0] * mx + e[4] * my + e[8] * mz + e[12],
    e[1] * mx + e[5] * my + e[9] * mz + e[13],
    e[2] * mx + e[6] * my + e[10] * mz + e[14],
  ];
  let error = 0;
  for (let axis = 0; axis < 3; axis++) {
    out[base + axis] = centre[axis];
    out[base + 4 + axis] = centre[axis] - out[base + axis];
    error += (centre[axis] - (out[base + axis] + out[base + 4 + axis])) ** 2;
  }
  const radius = Math.hypot(
    Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz,
    Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz,
    Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz,
  );
  out[base + 3] = f32AtOrAbove(radius + Math.sqrt(error));
}
