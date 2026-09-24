/**
 * The pose at `target[o]` moved on by `ahead` simulated seconds of the velocities at `velocity[v]`
 * (linear, then angular), into `pose`; its quaternion is left for the caller to normalise.
 */
export function extrapolate(
  pose: Float64Array,
  target: Float32Array,
  o: number,
  velocity: Float32Array,
  v: number,
  ahead: number,
) {
  for (let k = 0; k < 3; k++) pose[k] = target[o + k] + velocity[v + k] * ahead;
  // The turn at angular velocity ω over `ahead`: q += ½ (ω, 0) ⊗ q · ahead.
  const wx = velocity[v + 3],
    wy = velocity[v + 4],
    wz = velocity[v + 5];
  const x = target[o + 3],
    y = target[o + 4],
    z = target[o + 5],
    w = target[o + 6],
    h = ahead / 2;
  pose[3] = x + h * (wx * w + wy * z - wz * y);
  pose[4] = y + h * (wy * w + wz * x - wx * z);
  pose[5] = z + h * (wz * w + wx * y - wy * x);
  pose[6] = w - h * (wx * x + wy * y + wz * z);
}
