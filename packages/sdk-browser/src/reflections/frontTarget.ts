import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'

/**
 * The transparents' front depth as they write it (`frontDepth.ts`): its target's format, its
 * resources' label, and the one rule every transparent pipeline takes from here.
 */

/** The format the transparents write their front depth in, a half float. */
export const FRONT_FORMAT: GPUTextureFormat = 'r16float'
/** The label of every resource of the front depth. */
export const FRONT_LABEL = 'Trillion3D reflection front depth'

/** The front depth of a fragment that covers `coverage` of its pixel, for the blend's target: its
 *  depth a half-float's step behind, else zero (which the `max` blend ignores). */
export const REFLECTION_FRONT_WGSL = wgslBlock(
  'REFLECTION_FRONT_WGSL',
  [REFLECTION_CONSTANTS_WGSL],
  `fn reflectionFrontOut(position:vec4f,coverage:f32)->vec4f{
 return vec4f(select(0.0,position.z*(1.0-1.0/1024.0),coverage>=REFLECTION_FRONT_COVERAGE),0.0,0.0,0.0);
}`,
)

/**
 * The one rule of a transparent surface — a blend, a water surface —: it writes the front depth, as
 * the colour target `target` (the nearest of the fragments' depths) and the fragment output `out`
 * (`reflectionFrontOut`), which every transparent pipeline and its output list take from here.
 */
export const TRANSPARENT_FRONT: { target: GPUColorTargetState; out: [string, string] } = {
  target: {
    format: FRONT_FORMAT,
    writeMask: 0x1,
    blend: {
      color: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
      alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
    },
  },
  out: ['front', 'vec4f'],
}
