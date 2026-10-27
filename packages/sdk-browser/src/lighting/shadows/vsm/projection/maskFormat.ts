/**
 * THE LOCAL LIGHTS' MASK (`projectionWgsl.ts`, the one-pass projection): a texel a pixel, 4 bits a light — the
 * light's share of its shadow in sixteenths, `round(share · 15)` — in the order the pixel's cell lists the
 * shadowed local lights (`vsmMaskLaneOf`, `direct/shadowTraceWgsl.ts`), at most
 * `shadowOnePassProjectionMaxLightsPerPixel` of them. Its format holds as many words as the count asks.
 */
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'

const ONE_PASS_MASK_BITS = 4

/** The mask's lane as the projection packs it and the lighting reads it: its bits, its largest value and
 *  the lanes a 32-bit word holds. */
export const ONE_PASS_MASK_WGSL = wgslBlock(
  'ONE_PASS_MASK_WGSL',
  [],
  `
const ONE_PASS_MASK_BITS:u32=${ONE_PASS_MASK_BITS}u;
const ONE_PASS_MASK_MAX:u32=${(1 << ONE_PASS_MASK_BITS) - 1}u;
const ONE_PASS_MASK_LANES:u32=${32 / ONE_PASS_MASK_BITS}u;`,
)

/** The mask's format for `lights` lights a pixel: one 32-bit word up to 8, two up to 16, four up to 32. */
export const onePassMaskFormat = (lights: number): 'r32uint' | 'rg32uint' | 'rgba32uint' =>
  lights <= 8 ? 'r32uint' : lights <= 16 ? 'rg32uint' : 'rgba32uint'

/** The suns' mask: a layer a sun, the share of its shadow at each pixel. */
export const VSM_SUN_MASK_FORMAT: GPUTextureFormat = 'r32float'

/** The per-light path's screen mask (`perLightPass.ts`), a layer a light, each the shadow of its light at every pixel
 *  the light reaches: the share's square root, in every channel (the lighting reads the blue one), eight bits a channel,
 *  written by the light's projection itself. */
export const PER_LIGHT_MASK_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** The layers of that mask: the lights whose mask a frame keeps, so that a still frame traces none again. A frame with more
 *  lights traces each in turn into layer `light % PER_LIGHT_MASK_LAYERS`, drawn at once. */
export const PER_LIGHT_MASK_LAYERS = 4
