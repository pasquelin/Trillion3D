// What a display pixel is owed by the temporal resolve, from the definitions alone: the oracle
// `upscaleRun.fixture.ts`'s runs are checked against.
import type { UpscaleFrame } from './upscaleRun.fixture.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

/** The four-term Blackman-Harris window on a radius of one, from its definition. */
const kernel = (d: number) => {
  if (d >= 1) return 0
  const x = d * Math.PI + Math.PI
  return 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x)
}

/**
 * What a display pixel is owed, from the definition: its place `r` in the render grid (texel
 * centres at integers), each of the 3×3 texels around it weighed by the window, over `footprint`
 * (one render pixel while the history is resampled, one display pixel at rest), of the distance from
 * where this frame sampled it — its centre moved by `(−jx, +jy)` — to `r`, then clamped to the
 * `bounds` of the 3×3 (`box`) or left as it is (`none`).
 */
export function owed(frame: UpscaleFrame, px: number, py: number, bounds = 'none', footprint = 1) {
  const [w, h] = frame.render,
    [jx, jy] = frame.jitter ?? [0, 0]
  const r = [((px + 0.5) * w) / frame.display[0] - 0.5, ((py + 0.5) * h) / frame.display[1] - 0.5]
  const inGrid = (x: number, y: number) => [clamp(x, 0, w - 1), clamp(y, 0, h - 1)]
  const sum = [0, 0, 0, 0],
    lo = [1e9, 1e9, 1e9, 1e9],
    hi = [-1e9, -1e9, -1e9, -1e9]
  let total = 0
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const [x, y] = inGrid(Math.floor(r[0] + 0.5) + dx, Math.floor(r[1] + 0.5) + dy)
      const weight = kernel(Math.hypot(x - jx - r[0], y + jy - r[1]) * footprint)
      frame.color(x, y).forEach((c, i) => {
        sum[i] += c * weight
        lo[i] = Math.min(lo[i], c)
        hi[i] = Math.max(hi[i], c)
      })
      total += weight
    }
  return sum.map((s, i) => (bounds === 'box' ? clamp(s / total, lo[i], hi[i]) : s / total))
}
