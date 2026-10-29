// The light loop of the lit passes on one point and one cell's list, as the tests that run it read it: the
// base of the passes (`lightingBase`) with the environment's light and the fog, or with the light terms alone
// as the sun's pass and the local lights' hold them (`whole` false: the bindings of the GPU proofs'
// harness), the walk of a cell's whole list (`sliceLighting`), and `contractLighting`, the sum of the
// lights of a cell for a point — what every light term of the sun's pass, the local lights' and the blend
// is made of.
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  DEFERRED_CLOUD_SHADOW_BINDINGS,
  DEFERRED_FOG_BINDINGS,
  DEFERRED_LIGHT_FUNCTION_BINDINGS,
} from '../deferred/bindings.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from '../deferred/contractCuts.ts'
import { reflectionLobeWgsl } from '../lobeAxisWgsl.ts'
import { lightStrengthWgsl } from './lightStrengthWgsl.ts'
import { lightingBase, pixelCellWgsl, type LightingBindings } from './lightingWgsl.ts'
import { CONTRACT_SHADOW_BINDINGS } from './shadowBindings.ts'

/** What the lit passes bind for their light terms, all of them. */
const WHOLE_BINDINGS: LightingBindings = {
  vsmSunMask: CONTRACT_SHADOW_BINDINGS.vsmSunMask,
  vsmMask: CONTRACT_SHADOW_BINDINGS.vsmMask,
  maskFallback: CONTRACT_SHADOW_BINDINGS.fallback,
  fog: DEFERRED_FOG_BINDINGS,
  lightFunction: DEFERRED_LIGHT_FUNCTION_BINDINGS,
  cloudShadow: DEFERRED_CLOUD_SHADOW_BINDINGS,
}

/** What the local lights' pass binds for its light terms: the masks and the light functions. */
const LIGHT_BINDINGS: LightingBindings = {
  vsmSunMask: CONTRACT_SHADOW_BINDINGS.vsmSunMask,
  vsmMask: CONTRACT_SHADOW_BINDINGS.vsmMask,
  maskFallback: CONTRACT_SHADOW_BINDINGS.fallback,
  lightFunction: DEFERRED_LIGHT_FUNCTION_BINDINGS,
}

/** The light loop at the key `key` (`ContractKey`, `LOBELESS_KEY` unless given): with the environment's
 *  light and the fog, or, with `whole` false, the light terms alone. */
export const directLightingWgsl = (asked: Partial<ContractKey> = LOBELESS_KEY, whole = true) => {
  // The harness binds neither the scene's depth nor its flags: no contact shadow.
  const key = { contactless: true, ...asked }
  return wgslBlock(
    `directLightingWgsl(${variantLabel(key)}, ${whole})`,
    [
      whole
        ? lightingBase(WHOLE_BINDINGS, key, { narrow: !!key.narrow })
        : lightingBase(LIGHT_BINDINGS, key, { narrow: !!key.narrow, environment: false }),
      reflectionLobeWgsl(!key.lobeless),
      pixelCellWgsl(),
      // The harness lights at an exposure of 1.
      lightStrengthWgsl('1.0'),
    ],
    `
/** Contribution of the contract lights to the pixel, light by light of its cell's list (every light
 *  with none, \`cellSlice\`): the full sum, moving or still. */
fn contractLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,cell:u32)->vec3f{
 return sliceLighting(rgb,metal,rough,N,V,P,ao,cellSlice(cell));
}`,
  )
}
