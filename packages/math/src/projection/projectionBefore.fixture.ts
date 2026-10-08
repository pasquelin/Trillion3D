// The projections before they wrote their sixteen slots one by one, word for word but their names:
// the oracles `projectionMoves.test.ts` holds the shipped ones to.
import type { NumberSink } from '../matrix/matrix4.ts'
import { perspectiveSlope } from './camera.ts'

export function perspectiveProjectionBefore<T extends NumberSink>(
  out: T,
  fov: number,
  aspect: number,
  near: number,
  zoom: number,
) {
  const hy = (near * perspectiveSlope(fov)) / zoom, // this rounding order is fixed, bit for bit
    hx = aspect * hy
  for (let i = 0; i < 16; i++) out[i] = 0
  out[0] = near / hx
  out[5] = near / hy
  out[11] = -1
  out[14] = near
  return out
}

export function orthographicProjectionBefore<T extends NumberSink>(
  out: T,
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
) {
  const dx = right - left,
    dy = top - bottom,
    dz = far - near
  for (let i = 0; i < 16; i++) out[i] = 0
  out[0] = 2 / dx
  out[5] = 2 / dy
  out[10] = 1 / dz
  // `+ 0` keeps a centred box's offsets at +0, never −0.
  out[12] = -(left + right) / dx + 0
  out[13] = -(bottom + top) / dy + 0
  out[14] = far / dz
  out[15] = 1
  return out
}

export function forwardPerspectiveProjectionBefore<T extends NumberSink>(
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

export function forwardOrthographicProjectionBefore<T extends NumberSink>(
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
