// The capsule shadows' WGSL texts of `ENGINE_SHADERS`: the shadow pass of each mode (the indirect one also over the meshes' distance-field
// casters), the upsample draw with and without the second, ambient occlusion target, the pass that derives the light directions and the merge of the first-person self shadow into the masks, the ray traced shadow's kernel and its merge, and the shadow denoiser's passes.
import {
  capsuleShadowShader,
  type CapsuleMode,
} from '../../lighting/capsuleShadows/capsuleShadowWgsl.ts'
import { capsuleHooks } from '../../lighting/capsuleShadows/hooks.ts'
import { lightDirectionShader } from '../../lighting/capsuleShadows/lightDirectionWgsl.ts'
import {
  shadowFinalWgsl,
  shadowInjestWgsl,
  shadowSpatialWgsl,
} from '../../lighting/shadows/denoise/shadowDenoiseSpatialWgsl.ts'
import { shadowTemporalWgsl } from '../../lighting/shadows/denoise/shadowDenoiseTemporalWgsl.ts'
import { selfShadowMergeProgram } from '../../lighting/shadows/firstPerson/selfShadowWgsl.ts'
import {
  rayTracedMergeProgram,
  rayTracedProgram,
} from '../../lighting/shadows/rayTraced/rayTracedWgsl.ts'
import {
  capsuleComposeShader,
  capsuleUpsampleShader,
} from '../../lighting/capsuleShadows/upsampleWgsl.ts'

const MODES: readonly CapsuleMode[] = ['directional', 'point', 'indirect', 'skylight']
const shadow = capsuleHooks('capsuleParams.depth')
const upsample = capsuleHooks('upsampleParams.depth')

export const CAPSULE_SHADOW_SHADERS: Record<string, string> = {
  ...Object.fromEntries(
    MODES.map((mode) => [
      `CAPSULE_SHADOW_${mode.toUpperCase()}`,
      capsuleShadowShader(mode, shadow),
    ]),
  ),
  CAPSULE_SHADOW_INDIRECT_CASTERS: capsuleShadowShader('indirect', shadow, true),
  CAPSULE_UPSAMPLE: capsuleUpsampleShader(upsample, false),
  CAPSULE_UPSAMPLE_SSAO: capsuleUpsampleShader(upsample, true),
  CAPSULE_COMPOSE_SUN: capsuleComposeShader(upsample),
  CAPSULE_LIGHT_DIRECTION: lightDirectionShader(true),
  CAPSULE_LIGHT_DIRECTION_SKY: lightDirectionShader(false),
  SELF_SHADOW_MERGE: selfShadowMergeProgram(),
  RAY_TRACED_SHADOW: rayTracedProgram(),
  RAY_TRACED_MERGE: rayTracedMergeProgram(),
  SHADOW_DENOISE_INJEST: shadowInjestWgsl(),
  SHADOW_DENOISE_RECONSTRUCT: shadowSpatialWgsl('reconstruct'),
  SHADOW_DENOISE_WEB: shadowSpatialWgsl('web'),
  SHADOW_DENOISE_POST_FILTER: shadowSpatialWgsl('postFilter'),
  SHADOW_DENOISE_TEMPORAL: shadowTemporalWgsl(),
  SHADOW_DENOISE_OUTPUT: shadowFinalWgsl(false),
  SHADOW_DENOISE_SUN_OUTPUT: shadowFinalWgsl(true),
}
