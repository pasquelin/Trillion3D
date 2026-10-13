/**
 * How a surface composes over what is behind it, in the engine's own names (`Blending`), and the
 * one blend equation each name stands for.
 *
 * In linear light, with `s` the source colour, `a` its opacity, `d` what the target holds and `t`
 * its alpha: normal is `s·a + d·(1 − a)` (alpha `a + t·(1 − a)`), additive `d + s·a` (alpha
 * `t + a·a`), subtractive `d·(1 − s)` (alpha `t`), multiply `d·s` (alpha `t·a`), and none writes
 * `s` as it is — what the witness, three@0.174, computes for the same material. A custom equation
 * is not a mode the engine draws.
 */
import type { Blending } from '../../../sdk-core/src/world/constants/index.ts'

/** Every mode the engine draws, in the rank the transparent pass gives its pipelines: normal
 *  first, so a transmissive entry, which blends by its backdrop, indexes the first three. */
export const BLEND_MODES: readonly Blending[] = [
  'normal',
  'additive',
  'subtractive',
  'multiply',
  'none',
]

/** Why a surface's mode is drawn by no path, or `undefined`: the one refusal every draw shares. A transmissive surface composes by the backdrop it reads, and a mode the
 *  engine has no name for is no mode at all: both are refused by name, never drawn as normal. */
function blendingRefusal(blending: Blending | undefined, transmissive: boolean) {
  if (!blending) return 'a surface declares a blending no path draws'
  if (transmissive && blending !== 'normal')
    return `a transmissive material cannot use ${blending} blending`
}

/** The mode a transparent surface is drawn in; what `blendingRefusal` refuses
 *  is thrown by name. */
export function drawnBlending(blending: Blending | undefined, transmissive: boolean): Blending {
  const refusal = blendingRefusal(blending, transmissive)
  if (refusal) throw new Error(refusal)
  return blending!
}

/** A mode that adds to, takes from or filters the background: it means nothing drawn opaque, so
 *  a surface declaring one is drawn in the transparent pass. */
export const composesWithBackground = (blending: Blending) =>
  blending === 'additive' || blending === 'subtractive' || blending === 'multiply'

/** The target keeps its own alpha: subtractive composes the colour alone. */
const KEEP_ALPHA: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
const ADD: GPUBlendComponent = { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }
const MULTIPLY: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }

/** The equation of each mode, colour and alpha as the witness (three@0.174, straight alpha)
 *  writes them; `undefined` is no blending at all — the source replaces the target. */
export const BLEND_EQUATIONS: Record<Blending, GPUBlendState | undefined> = {
  normal: {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  },
  additive: { color: ADD, alpha: ADD },
  subtractive: {
    color: { srcFactor: 'zero', dstFactor: 'one-minus-src', operation: 'add' },
    alpha: KEEP_ALPHA,
  },
  multiply: { color: MULTIPLY, alpha: MULTIPLY },
  none: undefined,
}

/** A mode whose colour weighs the source by its alpha (`normal`, `additive`): its alpha is
 *  coverage. The others draw the colour under alpha 0 as it is. */
export const weighsByAlpha = (blending: Blending | undefined) =>
  !!blending && BLEND_EQUATIONS[blending]?.color.srcFactor === 'src-alpha'
