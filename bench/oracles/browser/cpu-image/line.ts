// The CPU image oracle's line: the twins, statement for statement, of the WGSL a GPU raster
// widens and dashes a line with (`packages/sdk-browser/src/visibility/shader/lineWgsl.ts`).
import { hypot2 } from '../../../../packages/sdk-core/src/math/primitives/hypot.ts'

/** `LINE_CLIP_WGSL` on the CPU, statement for statement, in the engine's reversed depth: the
 *  oracle's projection (`./projection.ts`) widens a line quad's corner with it. Writes into `out`,
 *  which may be `clip` itself; `viewport` is `[width, height]`. */
export function lineClip(
  out: Float64Array,
  clip: ArrayLike<number>,
  along: ArrayLike<number>,
  width: number,
  viewport: ArrayLike<number>,
  pixelRatio: number,
) {
  const f = clip[3] - clip[2],
    g = along[3] - along[2]
  const k = f < 0 && g !== 0 ? f / g : 0
  for (let i = 0; i < 4; i++) out[i] = clip[i] - along[i] * k
  const tx = (along[0] * out[3] - out[0] * along[3]) * viewport[0],
    ty = (along[1] * out[3] - out[1] * along[3]) * viewport[1]
  const n = hypot2(tx, ty)
  if (n === 0) return out
  const s = (width * pixelRatio) / n
  out[0] += ((-ty * s) / viewport[0]) * out[3]
  out[1] += ((tx * s) / viewport[1]) * out[3]
  return out
}

/** `LINE_DASH_WGSL` on the CPU, statement for statement: the oracle's dash. */
export function lineDash(at: number, dashSize: number, gapSize: number) {
  const period = dashSize + gapSize
  return dashSize <= 0 || at - period * Math.floor(at / period) <= dashSize
}
