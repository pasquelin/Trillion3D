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

/** The identifier word the visibility stage kept at texel `t` of a drawing (the fifth readback,
 *  `VIS_CARD_BASE | slot`, zero where no card covers it): the coverage word. */
const idAt = (s: Uint8Array[], t: number) =>
  new DataView(s[4].buffer, s[4].byteOffset).getUint32(t * 4, true)

/** What a texel covered in one drawing alone shows of each: its coverage word and surface flags. */
type Flip = { card: number; x: number; y: number; pool: number[]; chains: number[] }

/** How the two drawings `a` (the pool's) and `b` (the chains') of a `side`² image differ: the
 *  texels a card wrote in either; the FLIPS, covered in one drawing alone — the card's coverage
 *  cut met on either side of its threshold —, listed with their coverage words; and among the
 *  texels both cover, those differing at 8 bits and by how many steps at most — in all and by
 *  card slot —, and those whose half-float words differ at all. */
export function compareSurfaces(a: Uint8Array[], b: Uint8Array[], side: number) {
  let covered = 0,
    differ8 = 0,
    maxStep = 0,
    exact = 0
  const byCard: Record<
    number,
    { covered: number; differ8: number; maxStep: number; flips: number }
  > = {}
  const flips: Flip[] = []
  for (let t = 0; t < side * side; t++) {
    if (!a[3][t] && !b[3][t]) continue
    covered++
    const card = (idAt(a, t) || idAt(b, t)) & 0xffff
    const stats = (byCard[card] ??= { covered: 0, differ8: 0, maxStep: 0, flips: 0 })
    stats.covered++
    if (!a[3][t] || !b[3][t]) {
      stats.flips++
      flips.push({
        card,
        x: t % side,
        y: Math.floor(t / side),
        pool: [idAt(a, t), a[3][t]],
        chains: [idAt(b, t), b[3][t]],
      })
      continue
    }
    const [x, y] = [shown(a, t), shown(b, t)]
    const step = Math.max(...x.map((v, k) => Math.abs(v - y[k])))
    if (step > 0) differ8++
    maxStep = Math.max(maxStep, step)
    if (step > 0) stats.differ8++
    stats.maxStep = Math.max(stats.maxStep, step)
    if (
      [0, 1, 2].some((k) => a[k].subarray(t * 8, t * 8 + 8).some((v, i) => v !== b[k][t * 8 + i]))
    )
      exact++
  }
  return { covered, differ8, maxStep, exact, byCard, flips }
}
