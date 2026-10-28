// The scene of the tessellated sheet's shadow proof (`tessShadowPage.ts`), and what its geometry says of it, with nothing of a browser: the sheet, the
// camera, the spot, and the oracle that counts the floor pixels the displaced sheet shades under the spot from the geometry alone.

/** The sheet: its side, its height over the floor, the ridges across its second texture axis, how far the height 1 lies from the middle one. */
export const SHEET = { side: 4, height: 1.2, ridges: 3, magnitude: 0.6 } as const
/** The camera: straight over the floor, so that the floor's metres are the image's pixels at one scale. */
export const CAMERA = { height: 14, fov: 40 }
/** The spot: hanging in the slab the sheet is displaced through, over its middle, looking straight down. */
export const SPOT = { outerConeAngle: 1.2, innerConeAngle: 0.9, distance: 12 } as const

/** The ridge height 0 to 1 at texture coordinate `v`, as the graph writes it. */
export const heightAt = (v: number) => 0.5 + 0.5 * Math.sin(2 * Math.PI * SHEET.ridges * v)

/**
 * The height of the displaced sheet over the floor at `z`, which its ridges alone make vary (the displacement is along the sheet's normal, straight
 * up). The plane's second texture axis `v` runs from -side/2 to side/2 along its local y, which the rotation about x turns into -z, so that
 * `v = 0.5 - z / side`: the height is `SHEET.height + (heightAt(v) - 0.5) * SHEET.magnitude`.
 */
export const sheetHeightAt = (z: number) =>
  SHEET.height + (heightAt(0.5 - z / SHEET.side) - 0.5) * SHEET.magnitude

/** Whether the segment from the spot (over the floor's middle, `SHEET.height` up) to the floor point `(x, z)` crosses the displaced sheet. */
function sheetBlocks(x: number, z: number, steps: number) {
  const half = SHEET.side / 2
  let before = 0
  for (let k = 1; k <= steps; k++) {
    const t = k / steps
    const [sx, sz] = [t * x, t * z]
    if (Math.abs(sx) > half || Math.abs(sz) > half) {
      before = 0
      continue
    }
    // The ray's height less the sheet's under the same point: a change of its sign is a crossing.
    const above = SHEET.height * (1 - t) - sheetHeightAt(sz)
    if (before * above < 0) return true
    if (above !== 0) before = above
  }
  return false
}

/**
 * The floor pixels the spot's light is cut from by the sheet, from the geometry: for each pixel of the image outside the sheet's footprint
 * (`reach` pixels about the middle, the part blanked), whose floor point lies within the spot's outer cone (its angle from the straight-down axis
 * at most `SPOT.outerConeAngle`), the segment to the spot is tested against the displaced sheet. `size` is the image's, `metresPerPixel` its scale
 * (the camera's `CAMERA`, straight down, the image's middle over the floor's). The count is of the pixels that lie in the shadow of the ridges,
 * before the filter's penumbra, the cone's falloff and the margins of the images: a proof asks for part of it.
 */
export function spotShadowedPixels(
  size: { width: number; height: number },
  metresPerPixel: number,
  reach: number,
) {
  const tan = Math.tan(SPOT.outerConeAngle)
  let count = 0
  for (let py = 0; py < size.height; py++)
    for (let px = 0; px < size.width; px++) {
      if (Math.abs(px - size.width / 2) <= reach && Math.abs(py - size.height / 2) <= reach)
        continue
      const [x, z] = [
        (px + 0.5 - size.width / 2) * metresPerPixel,
        (py + 0.5 - size.height / 2) * metresPerPixel,
      ]
      if (Math.hypot(x, z) > SHEET.height * tan) continue
      if (sheetBlocks(x, z, 2000)) count++
    }
  return count
}
