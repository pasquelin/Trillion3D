/** The smallest byte `b` a surface cutting at `alphaTest` under a colour factor alpha `factor`
 *  keeps: `b / 255 × factor >= alphaTest` in f32, the product the engine cuts; 255 when none does,
 *  which the lowest over a texture's readers ignores beside any other (`cutoff_byte`,
 *  `coverage.rs`). */
export function cutoffByte(alphaTest: number, factor: number) {
  const cut = Math.fround(alphaTest),
    f = Math.fround(factor)
  // The test only grows with the byte, and f32 rounding moves its threshold `cut × 255 / f` by far
  // less than a byte: the search starts one byte under it, past 255 under no factor, never at 1.
  const from = f > 0 ? Math.max(1, Math.floor((cut * 255) / f) - 1) : 256
  for (let byte = from; byte < 256; byte++)
    if (Math.fround(Math.fround(byte / 255) * f) >= cut) return byte
  return 255
}
