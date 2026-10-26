import type { Blending } from '../../../sdk-core/src/world/constants/index.ts'
import {
  BLEND_EQUATIONS,
  OVER,
  composesWithBackground,
  weighsByAlpha,
} from '../materials/surface/materialBlending.ts'

/**
 * WebGPU's variants of the one blend table (`../materials/surface/materialBlending.ts`), which the
 * display layers write as a canvas of display values does: the reference display multiplies and
 * subtracts on a canvas that holds display values, after the tone curve (`display/displayFilter.ts`).
 */

/** The target keeps its alpha: a layer that leaves the coverage. */
export const KEEP: GPUBlendComponent = BLEND_EQUATIONS.subtractive.alpha
const SUBTRACT = BLEND_EQUATIONS.subtractive.color,
  MULTIPLY = BLEND_EQUATIONS.multiply.color

/** A mode that filters what is behind it, in display value: through the display filter. It
 *  composes with the background and does not weigh its colour by its alpha (subtractive,
 *  multiply), as the one classification of the modes says (`../materials/surface/materialBlending.ts`). */
export const filtersDisplay = (blending: Blending) =>
  composesWithBackground(blending) && !weighsByAlpha(blending)

/** How a pipeline of a filtered image routes its colour (`DISPLAY_ROUTE`, `display/displayFilter.ts`):
 *  a normal or additive layer goes to the display layers where a filter covers the pixel, a
 *  filtering mode always does. */
export const displayRoute = (blending: Blending) => (filtersDisplay(blending) ? 2 : 1)

/** Source added to destination, premultiplied: light laid over what is there. */
export const ADD_ONE: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one' }
const LAYER = (color: GPUBlendComponent): GPUBlendState => ({ color, alpha: KEEP })
const NORMAL_TINT = LAYER(BLEND_EQUATIONS.normal.alpha)
const FILTERING = { subtractive: LAYER(SUBTRACT), multiply: LAYER(MULTIPLY) }

/** The display layers, over the composed display value `c`: the image shows `c·t + a`. A layer
 *  `(s, α)` in display value maps `(t, a)` as a canvas of display values maps what it holds: normal to
 *  `(t·(1 − α), a·(1 − α) + s·α)`, additive to `(t, a + s·α)`, multiply to `(t·s, a·s)`,
 *  subtractive to `(t·(1 − s), a·(1 − s))`; alphaComposite maps as normal and alphaHoldout leaves
 *  them. The tint: */
export const TINT_EQUATIONS = {
  normal: NORMAL_TINT,
  additive: LAYER(KEEP),
  alphaComposite: NORMAL_TINT,
  alphaHoldout: LAYER(KEEP),
  ...FILTERING,
} satisfies Record<Blending, GPUBlendState | undefined>
/** …and the added value, written premultiplied. */
export const ADD_EQUATIONS = {
  normal: LAYER(OVER),
  additive: LAYER(ADD_ONE),
  alphaComposite: LAYER(OVER),
  alphaHoldout: LAYER(KEEP),
  ...FILTERING,
} satisfies Record<Blending, GPUBlendState | undefined>
