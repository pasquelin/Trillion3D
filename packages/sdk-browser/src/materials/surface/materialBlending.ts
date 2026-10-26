/**
 * How a surface composes over what is behind it, in the engine's own names (`Blending`), and the
 * one blend equation each name stands for.
 *
 * The equations act on the translucency target, which holds only the translucent layers, in
 * linear light: its colour `d` is what the layers add, its alpha `t` the share of the scene behind
 * them that shows through (the transmittance, cleared to 1) — the image is the scene times `t`,
 * plus `d` (`../../blend/translucency.ts`). With `s` the source colour and `a` its opacity: normal
 * is `s·a + d·(1 − a)` (alpha `t·(1 − a)`), additive `d + s·a` (alpha `t`), alphaComposite — a
 * colour already multiplied by its opacity — `s + d·(1 − a)` (alpha `t·(1 − a)`), alphaHoldout
 * `d·(1 − a)` (alpha `t·(1 − a)`: what lies behind the layer, the scene and the layers, is held out;
 * the hole it punches in the image's alpha is the alpha holdout's, `../../blend/holdout.ts`). Subtractive `d·(1 − s)` and multiply `d·s` act on the modulation target instead,
 * cleared to white, which multiplies the scene (colour alone, its alpha untouched). A custom
 * equation is not a mode the engine draws.
 */
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'

/** Every mode the engine draws, in the rank the transparent pass gives its pipelines: normal
 *  first, so a transmissive entry, which blends by its backdrop, indexes the first three. */
export const BLEND_MODES: readonly Blending[] = [
  'normal',
  'additive',
  'subtractive',
  'multiply',
  'alphaComposite',
  'alphaHoldout',
]

/** The pipeline constant naming the blending mode a blend pipeline draws (`BLEND_MODES`'s rank): the
 *  holdout's accumulation sums by it, the colour pass weighs the fog's inscattering by it. */
export const BLEND_MODE = 'BLEND_MODE'

/** The rank of `mode` as the shader reads it. */
const rankOf = (mode: Blending) => `${BLEND_MODES.indexOf(mode)}u`

/** The pipeline constant of a pipeline that draws `mode`. */
export const blendModeConstant = (mode: Blending) => ({ [BLEND_MODE]: BLEND_MODES.indexOf(mode) })

/** The WGSL condition that the pipeline's mode is one of `modes`. */
export const modeIs = (...modes: Blending[]) =>
  modes.map((mode) => `${BLEND_MODE}==${rankOf(mode)}`).join('||')

/** The mode a transparent surface is drawn in. A transmissive surface composes by the backdrop it
 *  reads, and a mode the engine has no name for is no mode at all: both are refused by name, thrown,
 *  never drawn as normal. */
export function drawnBlending(blending: Blending | undefined, transmissive: boolean): Blending {
  if (!blending || !BLEND_MODES.includes(blending))
    throw new Error('a surface declares a blending no path draws')
  if (transmissive && blending !== 'normal')
    throw new Error(`a transmissive material cannot use ${blending} blending`)
  return blending
}

/** A mode that adds to, takes from, filters or holds out the background: it means nothing drawn
 *  opaque, so a surface declaring one is drawn in the transparent pass. */
export const composesWithBackground = (blending: Blending) =>
  blending === 'additive' ||
  blending === 'subtractive' ||
  blending === 'multiply' ||
  blending === 'alphaHoldout'

/** A mode that multiplies the scene behind it, which the modulation target holds: subtractive and
 *  multiply. The others add to the translucency target. */
export const modulatesScene = (blending: Blending | undefined) =>
  blending === 'subtractive' || blending === 'multiply'

/** The target keeps its own alpha: additive and the modulating modes leave the transmittance. */
export const KEEP_ALPHA: GPUBlendComponent = {
  srcFactor: 'zero',
  dstFactor: 'one',
  operation: 'add',
}
/** The layer lets `1 − a` of what is behind it through. */
const TRANSMIT: GPUBlendComponent = {
  srcFactor: 'zero',
  dstFactor: 'one-minus-src-alpha',
  operation: 'add',
}
const ADD: GPUBlendComponent = { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }
const MULTIPLY: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }
/** Source over destination, premultiplied: the blend of one layer over another. */
export const OVER: GPUBlendComponent = {
  srcFactor: 'one',
  dstFactor: 'one-minus-src-alpha',
  operation: 'add',
}
/** `GPUColorWrite.ALPHA`: the write mask of the passes that lay the image's alpha alone. */
export const ALPHA_ONLY = 0x8
/** `GPUColorWrite.RED | GREEN | BLUE`: the write mask of the passes that leave the image's alpha alone. */
export const COLOUR_ONLY = 0x7

/** A light laid over what a source lets through: the source's colour added to the destination
 *  multiplied by the source's alpha (the share it lets through). */
export const LIGHT_THROUGH: GPUBlendComponent = {
  srcFactor: 'one',
  dstFactor: 'src-alpha',
  operation: 'add',
}
/** The destination multiplied by the source's alpha, the source's value not added. */
export const SCALED_BY_ALPHA: GPUBlendComponent = {
  srcFactor: 'zero',
  dstFactor: 'src-alpha',
  operation: 'add',
}
/** The equation of each mode, colour and alpha, on its target (see the header). */
export const BLEND_EQUATIONS = {
  normal: {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: TRANSMIT,
  },
  additive: { color: ADD, alpha: KEEP_ALPHA },
  subtractive: {
    color: { srcFactor: 'zero', dstFactor: 'one-minus-src', operation: 'add' },
    alpha: KEEP_ALPHA,
  },
  multiply: { color: MULTIPLY, alpha: KEEP_ALPHA },
  alphaComposite: { color: OVER, alpha: TRANSMIT },
  alphaHoldout: { color: TRANSMIT, alpha: TRANSMIT },
} satisfies Record<Blending, GPUBlendState>

/** A mode whose alpha is the layer's coverage: its colour is weighed by it, or the layer lets only
 *  the rest of what is behind through (`normal`, `additive`, `alphaComposite`, `alphaHoldout`).
 *  The others draw the colour under alpha 0 as it is. */
export const weighsByAlpha = (blending: Blending | undefined) =>
  blending === 'normal' ||
  blending === 'additive' ||
  blending === 'alphaComposite' ||
  blending === 'alphaHoldout'
