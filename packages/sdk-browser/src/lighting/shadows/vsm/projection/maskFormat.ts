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
