import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import { BLEND_EQUATIONS } from '../../scene/materialBlending.ts';

/**
 * WebGPU's variants of the one blend table (`../../scene/materialBlending.ts`), which they leave
 * as the witness, three@0.174, writes it. Its lit target's alpha is the coverage the composition
 * lays the background under (`../../lighting/deferred/shaders.ts`), and the witness multiplies and
 * subtracts on a canvas that holds display values, after the tone curve (`displayFilter.ts`).
 */

const KEEP = BLEND_EQUATIONS.subtractive!.alpha,
  SUBTRACT = BLEND_EQUATIONS.subtractive!.color,
  MULTIPLY = BLEND_EQUATIONS.multiply!.color;

/** The lit target: the witness draws over a canvas that already holds the background, opaque, so
 *  its `t·a` of multiply hides nothing there. Multiply keeps the target's coverage, as
 *  subtractive does: the background never shows through it. */
export const COVERAGE_EQUATIONS: Record<Blending, GPUBlendState | undefined> = {
  ...BLEND_EQUATIONS,
  multiply: { color: MULTIPLY, alpha: KEEP },
};

/** A mode that filters what is behind it, in display value: through the display filter. */
export const filtersDisplay = (blending: Blending) =>
  blending === 'subtractive' || blending === 'multiply';

/** The lit target in an image with a display filter: a filtering mode leaves it untouched. */
export const FILTERED_EQUATIONS: Record<Blending, GPUBlendState | undefined> = {
  ...COVERAGE_EQUATIONS,
  subtractive: { color: KEEP, alpha: KEEP },
  multiply: { color: KEEP, alpha: KEEP },
};

/** The display filter's equation per mode, white where nothing filters. A filtering mode writes
 *  its display colour `s`: multiply keeps `f·s`, subtractive `f·(1 − s)`. The others write white
 *  at their alpha: normal lifts the filter where it covers it, additive keeps it, none resets it. */
export const FILTER_EQUATIONS: Record<Blending, GPUBlendState | undefined> = {
  normal: BLEND_EQUATIONS.normal,
  additive: { color: KEEP, alpha: KEEP },
  subtractive: { color: SUBTRACT, alpha: KEEP },
  multiply: { color: MULTIPLY, alpha: KEEP },
  none: undefined,
};
