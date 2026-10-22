import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'

/** The most a surface colour is written at, pre-exposure applied: the greatest value of a 10-bit
 *  float, halved, which leaves room above it for the additive elements (bloom, clouds, particles)
 *  — the number of the material's emission, whatever the target. */
const MAX_EMISSIVE = 64512 * 0.5

/**
 * The ways a pass that writes light to the lit image applies the pre-exposure, over `factor`, the
 * WGSL expression of the number the pass was given (`PreExposure.now`):
 * - `preExposed(rgb)`, the light multiplied by it, nothing more;
 * - `preExposedClipped(rgb)`, the light multiplied by it and then held to `MAX_EMISSIVE`: the
 *   order of a surface's final write, where the sum of every term is multiplied by the
 *   pre-exposure first and the whole colour is clipped last;
 * One factor a program: the block is named by it.
 */
export const preExposedWgsl = (factor: string) =>
  wgslBlock(
    `preExposedWgsl(${factor})`,
    [],
    `fn preExposed(rgb:vec3f)->vec3f{return rgb*(${factor});}
fn preExposedClipped(rgb:vec3f)->vec3f{return min(rgb*(${factor}),vec3f(${wgslF32(MAX_EMISSIVE)}));}`,
  )
