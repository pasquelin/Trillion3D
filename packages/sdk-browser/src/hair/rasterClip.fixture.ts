// The CPU twin of the raster's cut of a segment to the view (`hairSpineClip`, `rasterWgsl.ts`), each
// operation rounded to a float as the shader rounds it.

const f = Math.fround

/** The parameters of the ends of the part of the segment from `h0` to `h1` (clip coordinates, the depth
 *  reversed) inside the six planes of the view; the first not below the second where none is. */
export function hairSpineClip(h0: readonly number[], h1: readonly number[]): [number, number] {
  let lo = 0,
    hi = 1
  for (let plane = 0; plane < 6; plane++) {
    const axis = plane >> 1
    const sign = plane & 1 ? -1 : 1
    const w = plane === 4 ? 0 : 1
    const b0 = f(w * h0[3]! + sign * h0[axis]!)
    const b1 = f(w * h1[3]! + sign * h1[axis]!)
    const denom = f(b0 - b1)
    if (denom < 0) lo = Math.max(lo, f(b0 / denom))
    else if (denom > 0) hi = Math.min(hi, f(b0 / denom))
    else if (b0 < 0) return [1, 0]
  }
  return [lo, hi]
}

/** `mix(a, b, t)` of two clip points, lane by lane, as the shader takes it. */
export const mixClip = (a: readonly number[], b: readonly number[], t: number) =>
  a.map((x, k) => f(f(x * f(1 - t)) + f(b[k]! * t)))
