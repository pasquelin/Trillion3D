import type { SurfaceDisplacement, VisMaterial } from '../materialType.ts'

/**
 * What a displaced surface's numbers say of the displacement, once for the table's record
 * (`../../materials/table/displacementRecord.ts`) and every reader of it: the least and the
 * greatest distance a point can move along its normal — the height 0 and 1 against the `center`
 * that stays on the surface, so the interval always holds zero —, and the on-screen size, in
 * pixels, of the greatest displacement below which the fade has taken all of it.
 */

/** The distances the heights 0 and 1 displace by: `(0 - center) * magnitude` and
 *  `(1 - center) * magnitude`, ordered, so that a negative magnitude still gives `min <= max`. */
export function displacementRange({
  magnitude,
  center,
}: Pick<SurfaceDisplacement, 'magnitude' | 'center'>) {
  const low = (0 - center) * magnitude,
    high = (1 - center) * magnitude
  return { min: Math.min(0, low, high), max: Math.max(0, low, high) }
}

/** The greatest distance a point moves, whichever way: what grows a bound that must hold it. */
function displacementReach(range: { min: number; max: number }) {
  return Math.max(-range.min, range.max)
}

/**
 * The size, in on-screen pixels of the greatest displacement, under which the displacement has
 * faded out wholly and the surface draws flat: the smaller of the fade range's two ends, none (0)
 * for a displacement that never fades. A bound the displacement is kept inside only above it.
 */
export function fadeOutPixels({ fade }: Pick<SurfaceDisplacement, 'fade'>) {
  return fade ? Math.min(fade.start, fade.end) : 0
}

/**
 * How far the displacement of any of `pages`' surfaces can move a point of them: the greatest
 * reach of their materials' displacements, zero where none is displaced. What a culling box of the
 * primitive grows by on every side, so that no displaced point lies outside the box that decides
 * whether the cut draws it.
 */
export function pagesDisplacementReach(
  pages: readonly { material?: Pick<VisMaterial, 'displacement' | 'displacementMap'> }[],
) {
  let reach = 0
  for (const { material } of pages)
    if (material?.displacement && material.displacementMap)
      reach = Math.max(reach, displacementReach(displacementRange(material.displacement)))
  return reach
}
