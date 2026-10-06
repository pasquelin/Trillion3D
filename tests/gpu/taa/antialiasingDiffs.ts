// Pixel classes for the temporal antialiasing proof: which pixels of an image moved once
// accumulation is on, at an edge or inside a surface.

/** Reach of accumulation round an edge, in pixels: half a jitter and the current image's 3×3
 *  filter cover one and a half pixels, hence two whole pixels. */
const REACH = 2

/** Whether, in `pixels`, a pixel within `REACH` of `(x, y)` has another colour: an edge. */
export function nearEdge(pixels: number[], x: number, y: number, width: number, height: number) {
  const i = (y * width + x) * 4
  for (let dy = -REACH; dy <= REACH; dy++)
    for (let dx = -REACH; dx <= REACH; dx++) {
      const px = x + dx,
        py = y + dy
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const j = (py * width + px) * 4
      if (
        pixels[i] !== pixels[j] ||
        pixels[i + 1] !== pixels[j + 1] ||
        pixels[i + 2] !== pixels[j + 2]
      )
        return true
    }
  return false
}

/** Pixels where `a` and `b` differ by more than `tolerance` on a channel, sorted into edge and
 *  interior by `b`, the image without accumulation; and the largest difference. */
export function changedPixels(
  a: number[],
  b: number[],
  tolerance: number,
  width: number,
  height: number,
) {
  let edges = 0,
    interior = 0,
    max = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      let d = 0
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]))
      max = Math.max(max, d)
      if (d <= tolerance) continue
      if (nearEdge(b, x, y, width, height)) edges++
      else interior++
    }
  return { edges, interior, max }
}
