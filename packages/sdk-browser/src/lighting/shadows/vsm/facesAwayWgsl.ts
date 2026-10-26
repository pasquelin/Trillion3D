import { wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { VSM_UNIT_PER_CM } from './constants.ts'

const CM = `${VSM_UNIT_PER_CM}`

/**
 * Whether the normal faces away from a local light `toLight` away (the vector, not its direction):
 * further than the sine of the light's half angle as the point sees it. The "+ 1 cm²" keeps the
 * nearInverse finite at the light's centre. The one text of the page marking, the projection's
 * region test and the lighting's read of a rectangle's shadow (`direct/lightLoopWgsl.ts`): each
 * gives a surface the same verdict.
 */
export const vsmFacesAwayFromLocal = wgslFn(
  'vsmFacesAwayFromLocal',
  [],
  `fn vsmFacesAwayFromLocal(toLight:vec3f,normal:vec3f,emitterSize:f32)->bool{
 let rangeSq=dot(toLight,toLight);
 let nearInverse=1.0/(rangeSq+${CM}*${CM});
 let invDist=inverseSqrt(rangeSq);
 let emitterSinSq=saturate(emitterSize*emitterSize*nearInverse);
 let emitterSin=sqrt(emitterSinSq);
 return dot(normal,toLight*invDist)< -emitterSin;
}`,
)
