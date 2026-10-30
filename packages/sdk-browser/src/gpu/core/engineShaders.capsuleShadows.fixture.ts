// The capsule shadows' WGSL texts of `ENGINE_SHADERS`: the shadow pass of each mode (the indirect one also over the meshes' distance-field
// casters), the upsample draw with and without the second, ambient occlusion target, the pass that derives the light directions and the merge of the first-person self shadow into the masks, the ray traced shadow's kernel and its merge, the ray traced occlusion's kernel and its denoiser's passes, the shadow denoiser's, the diffuse denoiser's (the ray-traced sky light's), the sun's distance-field cascade's trace and upsample, and the translucent object shadows' projection into a local light's layer and a sun's.
import {
  capsuleShadowShader,
  type CapsuleMode,
} from '../../lighting/capsuleShadows/capsuleShadowWgsl.ts'
import { capsuleHooks } from '../../lighting/capsuleShadows/hooks.ts'
import { lightDirectionShader } from '../../lighting/capsuleShadows/lightDirectionWgsl.ts'
import {
  fieldShadowTraceProgram,
  fieldShadowUpsampleProgram,
} from '../../lighting/shadows/classic/fieldShadow/fieldShadowWgsl.ts'
import {
  occlusionFinalWgsl,
  occlusionInjestWgsl,
  occlusionRejectionWgsl,
  occlusionTemporalWgsl,
} from '../../lighting/shadows/denoise/occlusionDenoiseWgsl.ts'
import {
  shadowFinalWgsl,
  shadowInjestWgsl,
  shadowSpatialWgsl,
} from '../../lighting/shadows/denoise/shadowDenoiseSpatialWgsl.ts'
import { shadowTemporalWgsl } from '../../lighting/shadows/denoise/shadowDenoiseTemporalWgsl.ts'
import {
  diffuseFinalWgsl,
  diffusePostFilterWgsl,
  diffusePreConvolveWgsl,
  diffuseReconstructWgsl,
  diffuseTemporalWgsl,
} from '../../lighting/shadows/denoise/diffuseDenoiseWgsl.ts'
import { selfShadowMergeProgram } from '../../lighting/shadows/firstPerson/selfShadowWgsl.ts'
import { rayTracedAoProgram } from '../../lighting/ao/rayTraced/rayTracedAoWgsl.ts'
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
  RAY_TRACED_AMBIENT_OCCLUSION: rayTracedAoProgram(),
  SHADOW_DENOISE_INJEST: shadowInjestWgsl(),
  SHADOW_DENOISE_RECONSTRUCT: shadowSpatialWgsl('reconstruct'),
  SHADOW_DENOISE_WEB: shadowSpatialWgsl('web'),
  SHADOW_DENOISE_POST_FILTER: shadowSpatialWgsl('postFilter'),
  SHADOW_DENOISE_TEMPORAL: shadowTemporalWgsl(),
  SHADOW_DENOISE_OUTPUT: shadowFinalWgsl(false),
  SHADOW_DENOISE_SUN_OUTPUT: shadowFinalWgsl(true),
  OCCLUSION_DENOISE_INJEST: occlusionInjestWgsl(),
  OCCLUSION_DENOISE_RECONSTRUCT: shadowSpatialWgsl('reconstruct', 'occlusion'),
  OCCLUSION_DENOISE_WEB: shadowSpatialWgsl('web', 'occlusion'),
  OCCLUSION_DENOISE_POST_FILTER: shadowSpatialWgsl('postFilter', 'occlusion'),
  OCCLUSION_DENOISE_REJECTION: occlusionRejectionWgsl(),
  OCCLUSION_DENOISE_TEMPORAL: occlusionTemporalWgsl(),
  OCCLUSION_DENOISE_OUTPUT: occlusionFinalWgsl(),
  DIFFUSE_DENOISE_RECONSTRUCT: diffuseReconstructWgsl(),
  DIFFUSE_DENOISE_WEB: diffusePreConvolveWgsl(),
  DIFFUSE_DENOISE_TEMPORAL: diffuseTemporalWgsl(),
  DIFFUSE_DENOISE_POST_FILTER: diffusePostFilterWgsl(),
  DIFFUSE_DENOISE_OUTPUT: diffuseFinalWgsl(),
}
