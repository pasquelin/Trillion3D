import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  LIGHT_PROFILE_BITS,
  LIGHT_PROFILE_SHIFT,
} from '../../../../sdk-core/src/scene/light/contracts.ts'
import { kindWord, lightTraits } from '../direct/lightReachWgsl.ts'
import { lightProfileMultiplierWgsl } from './lightProfileText.ts'
import { type LightProfileBindings, lightProfileBindingsLabel } from './lightProfileText.ts'

/** The profile lane of a light (`LIGHT_PROFILE_SHIFT`, `LIGHT_PROFILE_BITS` bits of its kind word): the atlas slice plus one, 0 for none. */
export const LIGHT_PROFILE_LANE_WGSL = wgslBlock(
  'LIGHT_PROFILE_LANE_WGSL',
  [kindWord],
  `fn lightProfileLane(light:DirectLight)->u32{
 return (kindWord(light)>>${LIGHT_PROFILE_SHIFT}u)&${2 ** LIGHT_PROFILE_BITS - 1}u;
}`,
)

/**
 * The profile factor of a light at a point: its profile lane (`lightProfileLane`) read, the light's place, its direction and its unit axis (`emitterAxisOf`, which a
 * profiled light always carries) handed to `lightProfileMultiplier`. The lane tested first, a
 * light with no profile costs the one compare.
 */
export const lightProfileOfWgsl = (b: LightProfileBindings) =>
  wgslBlock(
    `lightProfileOfWgsl(${lightProfileBindingsLabel(b)})`,
    [lightProfileMultiplierWgsl(b), LIGHT_PROFILE_LANE_WGSL, lightTraits],
    `fn lightProfileOf(light:DirectLight,P:vec3f)->f32{
 let lane=lightProfileLane(light);
 if(lane==0u){return 1.0;}
 return lightProfileMultiplier(P,light.positionRange.xyz,light.directionCone.xyz,emitterAxisOf(light),i32(lane)-1);
}`,
  )

/** What a program that reads no profile answers: 1, a light unchanged. */
export const NO_LIGHT_PROFILE_WGSL = wgslBlock(
  'NO_LIGHT_PROFILE_WGSL',
  [],
  'fn lightProfileOf(light:DirectLight,P:vec3f)->f32{return 1.0;}',
)
