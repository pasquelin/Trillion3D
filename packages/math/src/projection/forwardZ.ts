import type { NumberSink } from '../matrix/matrix4.ts'

/**
 * Projections of a view looking down +z — a shadow map's light, whose depth grows ahead of it —
 * in the engine's REVERSED depth (`./camera.ts`): `near` projects to 1, `far` to 0. The camera's
 * own projections look down −z; these are their mirror, column-major as theirs.
 */

/**
 * A square perspective down +z of projection scale `scale` (`focalScale` of its half field),
 * between depths `near` and `far`: clip `w = z`, depth `z_clip / w` falling from 1 at `near` to 0
 * at `far`. Into zeroed `out`: `out[0] = out[5] = scale`, `out[10] = near / (near − far)`,
 * `out[11] = 1`, `out[14] = (−far·near) / (near − far)`. A range of no thickness (`near === far`)
 * takes `out[10] = 0` and `out[14] = near`: every depth then projects to `near / z`, 1 on the plane.
 */
export function forwardPerspectiveProjection<T extends NumberSink>(
  out: T,
  scale: number,
  near: number,
  far: number,
) {
  for (let i = 0; i < 16; i++) out[i] = 0
  out[0] = scale
  out[5] = scale
  out[10] = near === far ? 0 : near / (near - far)
  out[11] = 1
  out[14] = near === far ? near : (-far * near) / (near - far)
  return out
}

/**
 * An orthographic projection down +z of half extents `hw × hh`, depth `1 − (z + depthOffset) ·
 * depthScale`: 1 at `z = −depthOffset`, 0 one `1 / depthScale` further. Into zeroed `out`:
 * `out[0] = 1 / hw` (1 for a zero half width), `out[5] = 1 / hh` likewise,
 * `out[10] = −depthScale`, `out[14] = 1 − depthOffset · depthScale`, `out[15] = 1`.
 */
export function forwardOrthographicProjection<T extends NumberSink>(
  out: T,
  hw: number,
  hh: number,
  depthScale: number,
  depthOffset: number,
) {
  for (let i = 0; i < 16; i++) out[i] = 0
  out[0] = hw !== 0 ? 1 / hw : 1
  out[5] = hh !== 0 ? 1 / hh : 1
  out[10] = -depthScale
  out[14] = 1 - depthOffset * depthScale
  out[15] = 1
  return out
}
