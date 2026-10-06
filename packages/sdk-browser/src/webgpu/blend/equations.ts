import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { BLEND_EQUATIONS } from '../../scene/materialBlending.ts'

/**
 * WebGPU's variants of the one blend table (`../../scene/materialBlending.ts`), which they leave
 * as a canvas of display values writes it. Its lit target's alpha is the coverage the composition
 * lays the background under (`../../lighting/deferred/shaders.ts`), and the reference display multiplies and
 * subtracts on a canvas that holds display values, after the tone curve (`displayFilter.ts`).
 */

const KEEP = BLEND_EQUATIONS.subtractive!.alpha,
  SUBTRACT = BLEND_EQUATIONS.subtractive!.color,
  MULTIPLY = BLEND_EQUATIONS.multiply!.color

/** The lit target: the reference display draws over a canvas that already holds the background, opaque, so
 *  its `t·a` of multiply hides nothing there. Multiply keeps the target's coverage, as
 *  subtractive does: the background never shows through it. */
export const COVERAGE_EQUATIONS: Record<Blending, GPUBlendState | undefined> = {
  ...BLEND_EQUATIONS,
  multiply: { color: MULTIPLY, alpha: KEEP },
}

/** A mode that filters what is behind it, in display value: through the display filter. */
export const filtersDisplay = (blending: Blending) =>
  blending === 'subtractive' || blending === 'multiply'

/** How a pipeline of a filtered image routes its colour (`DISPLAY_ROUTE`, `displayFilter.ts`):
 *  a normal or additive layer goes to the display layers where a filter covers the pixel, a
 *  filtering mode always does, `none` resets them. */
export const displayRoute = (blending: Blending) =>
  filtersDisplay(blending) ? 2 : blending === 'none' ? 0 : 1

const OVER: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
const LAYER = (color: GPUBlendComponent): GPUBlendState => ({ color, alpha: KEEP })
const FILTERING = { subtractive: LAYER(SUBTRACT), multiply: LAYER(MULTIPLY), none: undefined }

/** The display layers, over the composed display value `c`: the image shows `c·t + a`. A layer
 *  `(s, α)` in display value maps `(t, a)` as a canvas of display values maps what it holds: normal to
 *  `(t·(1 − α), a·(1 − α) + s·α)`, additive to `(t, a + s·α)`, multiply to `(t·s, a·s)`,
 *  subtractive to `(t·(1 − s), a·(1 − s))`; `none` replaces them with `(1, 0)`. The tint: */
export const TINT_EQUATIONS: Record<Blending, GPUBlendState | undefined> = {
  normal: LAYER({ srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' }),
  additive: LAYER(KEEP),
  ...FILTERING,
}
/** …and the added value, written premultiplied. */
export const ADD_EQUATIONS: Record<Blending, GPUBlendState | undefined> = {
  normal: LAYER(OVER),
  additive: LAYER({ srcFactor: 'one', dstFactor: 'one' }),
  ...FILTERING,
}
