// The sky module's WGSL texts of `ENGINE_SHADERS`: the clouds' generators, march, view programs and
// composition, the sky light's faces, copies and filters, the atmosphere's tables, haze and sky in each
// shape the quality settings make of them, and the light shafts.
import { CLOUD_SHADOW_DEBUG_WGSL } from '../../modules/sky/clouds/shadowDebugWgsl.ts'
import { emptySpaceProgram } from '../../modules/sky/clouds/emptySpaceWgsl.ts'
import { LIGHTNING_CODE } from '../../modules/sky/clouds/lightningWgsl.ts'
import { cloudHazeProgram } from '../../modules/sky/clouds/traceHazeProgram.ts'
import { cloudTraceProgram } from '../../modules/sky/clouds/traceWgsl.ts'
import { reconstructProgram } from '../../modules/sky/clouds/reconstructWgsl.ts'
import { composeProgram } from '../../modules/sky/clouds/composeWgsl.ts'
import { depthRangeProgram } from '../../modules/sky/clouds/depthRangeWgsl.ts'
import { cloudSetupOf } from '../../modules/sky/clouds/cloudModes.ts'
import { MIP_CODE } from '../../modules/sky/clouds/mipsWgsl.ts'
import { MASK_CODE } from '../../modules/sky/clouds/maskWgsl.ts'
import { NOISE_VOLUME_CODE } from '../../modules/sky/clouds/noiseVolumeWgsl.ts'
import { PATTERN_CODE } from '../../modules/sky/clouds/patternWgsl.ts'
import { PROFILE_CODE } from '../../modules/sky/clouds/profileWgsl.ts'
import { COPY_CODE } from '../../modules/sky/skyLight/copyWgsl.ts'
import {
  COMPOSE_FACE_CODE,
  fogFaceProgram,
  skyFaceProgram,
} from '../../modules/sky/skyLight/faceWgsl.ts'
import { FILTER_CODE } from '../../modules/sky/skyLight/filterWgsl.ts'
import { IRRADIANCE_CODE } from '../../modules/sky/skyLight/irradianceWgsl.ts'
import { AIR_SHADERS, airProgramsOf } from '../../lighting/atmosphere/airPrograms.fixture.ts'
import { opaqueHazeProgram } from '../../lighting/atmosphere/opaqueHazeWgsl.ts'
import { airShapeOf, DEFAULT_AIR_SHAPE } from '../../lighting/atmosphere/shape.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { SKY_QUALITY_RULES } from '../../../../sdk-core/src/modules/sky/quality.ts'
import { lightShaftProgram } from '../../modules/sky/lightShafts/wgsl.ts'
import { lightShaftTemporalProgram } from '../../modules/sky/lightShafts/temporalWgsl.ts'

/** The settings of the shapes of the air that are listed besides the defaults'. */
const AIR_SHAPES = {
  CINEMATIC: {
    skyTableFast: false,
    aerialFastOnOpaque: false,
    aerialSamplesPerSlice: 8,
    aerialDepthSlices: 32,
    skyTableSamplesMax: 256,
    atmosphereSamplesMin: 8,
    atmosphereSamplesMax: 256,
    transmittanceSamples: 30,
    multiScatterSamples: 20,
    multiScatterHighQuality: true,
    skyTablesFullPrecision: true,
  },
  SMALL: {
    transmittanceSmallFormat: true,
    transmittanceTable: false,
    atmosphereSampleLightShadowMap: false,
    distantSkyLightTable: false,
  },
}

/** The view's clouds, as the quality settings make them (`../../modules/sky/clouds/viewPrograms.ts`):
 *  the depth range passes, the trace of the plainest and of the fullest options, the haze pass, the
 *  reconstruction of the first image and of one with a history, with the fog laid on its image for
 *  the translucent surfaces (two surfaces, and one), and the composition of a cloud target and of a
 *  direct trace. */
function cloudViewTexts() {
  const quality = resolveSettings(SKY_QUALITY_RULES, {})
  const target = cloudSetupOf(quality)
  const direct = cloudSetupOf({ ...quality, cloudRenderTarget: false })
  const fogged = cloudSetupOf({ ...quality, cloudFogLateOnTranslucent: true })
  const foggedOne = cloudSetupOf({
    ...quality,
    cloudFogLateOnTranslucent: true,
    cloudTraceSize: 'quarterToFull',
  })
  const options = {
    emptySpace: false,
    opaqueShadow: true,
    localLights: true,
    skyLight: false,
    volumeShadowMap: false,
    closestDepth: false,
  }
  return {
    CLOUD_DEPTH_RANGE_DEPTH: depthRangeProgram('depth'),
    CLOUD_DEPTH_RANGE_RANGE: depthRangeProgram('range'),
    CLOUD_DEPTH_RANGE_CHECKERBOARD: depthRangeProgram('checkerboard'),
    CLOUD_TRACE_RANGE: cloudTraceProgram({ depth: 'range', minMaxDepth: true, ...options }),
    CLOUD_TRACE_SCENE: cloudTraceProgram({
      depth: 'scene',
      minMaxDepth: false,
      emptySpace: false,
      opaqueShadow: false,
      localLights: false,
      skyLight: false,
      volumeShadowMap: false,
      closestDepth: false,
    }),
    // The march started where the empty-space table says the cloud does.
    CLOUD_TRACE_EMPTY_SPACE: cloudTraceProgram({
      depth: 'scene',
      minMaxDepth: false,
      emptySpace: true,
      opaqueShadow: false,
      localLights: false,
      skyLight: false,
      volumeShadowMap: false,
      closestDepth: false,
    }),
    // The cloud's own shade read from the clouds' shadow maps, no ray marched toward the lights.
    CLOUD_TRACE_SHADOW_MAPS: cloudTraceProgram({
      depth: 'scene',
      minMaxDepth: false,
      emptySpace: false,
      opaqueShadow: false,
      localLights: false,
      skyLight: false,
      volumeShadowMap: true,
      closestDepth: false,
    }),
    // A scene with no air: the distant sky light read from the sky light's harmonics.
    CLOUD_TRACE_AIRLESS: cloudTraceProgram({
      depth: 'scene',
      minMaxDepth: false,
      emptySpace: false,
      opaqueShadow: false,
      localLights: false,
      skyLight: true,
      volumeShadowMap: false,
      closestDepth: false,
    }),
    CLOUD_HAZE: cloudHazeProgram(DEFAULT_AIR_SHAPE).code,
    CLOUD_RECONSTRUCT_FIRST: reconstructProgram(target, false),
    CLOUD_RECONSTRUCT_HISTORY: reconstructProgram(target, true),
    // The fog laid on the reconstructed image, for the translucent surfaces (`lateFogOnTranslucent`).
    CLOUD_RECONSTRUCT_FOGGED: reconstructProgram(fogged, true),
    CLOUD_RECONSTRUCT_FOGGED_ONE_SURFACE: reconstructProgram(foggedOne, true),
    CLOUD_COMPOSE_TARGET: composeProgram(target),
    CLOUD_COMPOSE_DIRECT: composeProgram(direct),
    // The alpha holdout's second draw: the clouds that hold out, then the haze and the fog alone.
    CLOUD_COMPOSE_HELD: composeProgram(target, true, { cloud: true }),
    CLOUD_COMPOSE_HELD_ABOVE: composeProgram(target, true, { cloud: false }),
  }
}

export const SKY_SHADERS: Record<string, string> = {
  // The sky module's texts: the cloud textures' generators, the empty-space march, the sky light's
  // faces, copies and filters.
  CLOUD_EMPTY_SPACE_CODE: emptySpaceProgram(true).code,
  CLOUD_EMPTY_SPACE_CENTRE_CODE: emptySpaceProgram(false).code,
  ...cloudViewTexts(),
  MIP_CODE,
  LIGHTNING_CODE,
  MASK_CODE,
  NOISE_VOLUME_CODE,
  PATTERN_CODE,
  PROFILE_CODE,
  SKY_LIGHT_COPY_CODE: COPY_CODE,
  SKY_LIGHT_SKY_FACE_CODE: skyFaceProgram(DEFAULT_AIR_SHAPE).code,
  SKY_LIGHT_FOG_FACE_CODE: fogFaceProgram(DEFAULT_AIR_SHAPE).code,
  COMPOSE_FACE_CODE,
  FILTER_CODE,
  IRRADIANCE_CODE,
  // The atmosphere's tables, haze, sky and sums (`../../lighting/atmosphere/`).
  ...Object.fromEntries(
    Object.entries(AIR_SHADERS).map(([name, code]) => [`AIR_${name.toUpperCase()}`, code]),
  ),
  // The shapes the quality settings can make of them: the cinematic level's, which marches the sky and
  // keeps the haze and the air apart, and the smallest tables, with no table and no shadows.
  ...Object.fromEntries(
    Object.entries(AIR_SHAPES).flatMap(([shape, settings]) =>
      Object.entries(airProgramsOf(airShapeOf(resolveSettings(SKY_QUALITY_RULES, settings)))).map(
        ([name, program]) => [`AIR_${shape}_${name.toUpperCase()}`, program.code],
      ),
    ),
  ),
  // The haze marched on the opaque surfaces (`aerialFastOnOpaque` off).
  AIR_OPAQUE_HAZE: opaqueHazeProgram(
    airShapeOf(resolveSettings(SKY_QUALITY_RULES, { aerialFastOnOpaque: false })),
  ).code,
  // The light shafts' passes and their temporal filter (`../../modules/sky/lightShafts/`).
  lightShaftProgram,
  lightShaftTemporalProgram,
  // The clouds' shadow and sky occlusion maps drawn over the image.
  CLOUD_SHADOW_DEBUG_WGSL,
}
