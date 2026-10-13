// The comparison of proof P3 (`cardTilesPage.ts`): two drawings of the card surfaces, compared texel
// by texel at the 8 bits the image is shown in — the base colour as its sRGB byte, the normal as
// `n·½+½`, the metal, roughness and occlusion as unit bytes —, the identifier flags exactly.
import { linearToSrgb8, unorm8 } from '../../../packages/math/src/color/color.ts'
import { half } from './cardIdRig.ts'

/** Bytes per texel of the four surfaces (`SURFACE_FORMATS`): three half-float RGBA, one byte. */
export const surfaceBytes = [8, 8, 8, 1]

/** The 8-bit values of texel `t` of the surfaces `s`, in a fixed order. */
function shown(s: Uint8Array[], t: number) {
  const halves = (k: number) => {
    const view = new DataView(s[k].buffer, s[k].byteOffset)
    return [0, 1, 2, 3].map((c) => half(view.getUint16(t * 8 + c * 2, true)))
  }
  const [base, normal, emissive] = [0, 1, 2].map(halves)
  return [
    ...base.slice(0, 3).map(linearToSrgb8),
    unorm8(base[3]),
    ...normal.slice(0, 3).map((n) => unorm8(n * 0.5 + 0.5)),
    unorm8(normal[3]),
    unorm8(emissive[3]),
    s[3][t],
  ]
}

/** How the two drawings differ: the texels a card wrote in either, those differing at 8 bits and by
 *  how many steps at most, and those whose half-float words differ at all. */
export function compareSurfaces(a: Uint8Array[], b: Uint8Array[], texels: number) {
  let covered = 0,
    differ8 = 0,
    maxStep = 0,
    exact = 0
  for (let t = 0; t < texels; t++) {
    if (!a[3][t] && !b[3][t]) continue
    covered++
    const [x, y] = [shown(a, t), shown(b, t)]
    const step = Math.max(...x.map((v, k) => Math.abs(v - y[k])))
    if (step > 0) differ8++
    maxStep = Math.max(maxStep, step)
    if (
      [0, 1, 2].some((k) => a[k].subarray(t * 8, t * 8 + 8).some((v, i) => v !== b[k][t * 8 + i]))
    )
      exact++
  }
  return { covered, differ8, maxStep, exact }
}
