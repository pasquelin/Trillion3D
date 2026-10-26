import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SKY_DIFFUSE_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'

/**
 * THE INDIRECT LIGHT OF A POINT THE SCREEN PROBES DID NOT READ (`indirectIrradiance`): the sky light's irradiance, the sky nothing
 * hides (`skyIrradiance`), where one shines; none else — a scene with no sky light has nothing unoccluded to give there, its environment
 * (ambient, hemisphere) being the pixel's own term beside it. A pixel the screen probes read takes their light (`screenDiffuse`,
 * `screen/indirectWgsl.ts`): the sky is in it, their rays that leave the scene reaching it.
 */
export const INDIRECT_WGSL = wgslBlock(
  'INDIRECT_WGSL',
  [SKY_DIFFUSE_READ_WGSL],
  `fn indirectIrradiance(P:vec3f,N:vec3f)->vec3f{
 if(!skyLit()){return vec3f(0.0);}
 return skyIrradiance(N);
}`,
)
