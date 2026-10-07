// What a display pixel is owed by the upscaling resolve, from the definitions alone: the oracles
// `upscaleRun.fixture.ts`'s runs are checked against.
import type { UpscaleFrame } from './upscaleRun.fixture.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))
/** Lanczos-2 from its definition, `sinc(x)·sinc(x/2)` on `|x| < 2`. */
const kernel = (x: number) => (x >= 2 ? 0 : sinc(x) * sinc(x / 2))

/**
 * What a display pixel is owed, from the definition: its place `r` in the render grid (texel
 * centres at integers), each of the 3×3 texels around it weighed by Lanczos-2 of the distance from
 * where this frame sampled it — its centre moved by `(−jx, +jy)`, `weights.ts`'s convention — to
 * `r`, then clamped to the `bounds` of the 2×2 texels around `r` (`ring`), of the 3×3 (`box`), or
 * left ringing (`none`).
 */
export function owed(frame: UpscaleFrame, px: number, py: number, bounds = 'ring') {
  const [w, h] = frame.render,
    [jx, jy] = frame.jitter ?? [0, 0]
  const r = [((px + 0.5) * w) / frame.display[0] - 0.5, ((py + 0.5) * h) / frame.display[1] - 0.5]
  const inGrid = (x: number, y: number) => [clamp(x, 0, w - 1), clamp(y, 0, h - 1)]
  const sum = [0, 0, 0, 0],
    lo = [1e9, 1e9, 1e9, 1e9],
    hi = [-1e9, -1e9, -1e9, -1e9]
  const bound = (x: number, y: number) =>
    frame
      .color(x, y)
      .forEach((c, i) => ((lo[i] = Math.min(lo[i], c)), (hi[i] = Math.max(hi[i], c))))
  let total = 0
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const [x, y] = inGrid(Math.floor(r[0] + 0.5) + dx, Math.floor(r[1] + 0.5) + dy)
      const weight = kernel(Math.hypot(x - jx - r[0], y + jy - r[1]))
      frame.color(x, y).forEach((c, i) => (sum[i] += c * weight))
      total += weight
      if (bounds === 'box') bound(x, y)
    }
  if (bounds === 'ring')
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
      bound(...(inGrid(Math.floor(r[0]) + dx, Math.floor(r[1]) + dy) as [number, number]))
  return sum.map((s, i) => (bounds === 'none' ? s / total : clamp(s / total, lo[i], hi[i])))
}
