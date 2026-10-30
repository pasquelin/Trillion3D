import { SAMPLED_LIGHTS_RULES } from '../contracts/sampledLightsOptions.ts'
import { RECT_LIGHT_ATLAS_RULES } from '../contracts/rectLightAtlasOptions.ts'
import { SIMPLE_LIGHT_RULES } from '../contracts/simpleLightOptions.ts'
import { PATH_TRACING_RULES } from '../contracts/pathTracingOptions.ts'
import { SHADING_RULES } from '../contracts/shadingOptions.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { Ajv } from 'ajv'
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts'
import { explorerSwitch, type ExplorerSwitch } from '../runtime/explorerSwitches.ts'
import { EXPLORER_SWITCH_NAMES } from '../runtime/explorerSwitches.fixture.ts'
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
} from '../contracts/poolBudgets.ts'
import { DEFAULT_TEXTURE_UPLOAD_MS } from '../../../sdk-browser/src/session/memory/textureTransferDefaults.ts'
import { WORLD_STREAMING_RULES } from '../contracts/worldStreamingOptions.ts'
import { resolveSetting, type SettingRule } from '../contracts/settingRules.ts'
import { CUT_RULES } from '../contracts/cutOptions.ts'
import { DYNAMIC_RESOLUTION_RULES } from '../contracts/dynamicResolutionOptions.ts'
import { ANIMATION_RULES } from '../contracts/animationOptions.ts'
import { TEMPORAL_RULES } from '../contracts/temporalOptions.ts'
import { HIZ_RULES } from '../contracts/hizOptions.ts'
import { LIGHT_FUNCTION_RULES } from '../contracts/lightFunctionOptions.ts'
import { LIGHT_PROFILE_RULES } from '../contracts/lightProfileOptions.ts'
import { SEPARATE_TRANSLUCENCY_RULES } from '../contracts/separateTranslucencyOptions.ts'
import { DISTANCE_FIELD_OCCLUSION_RULES } from '../contracts/distanceFieldOcclusionOptions.ts'
import { GLOBAL_DISTANCE_FIELD_RULES } from '../contracts/globalDistanceFieldOptions.ts'
import { VOLUMETRIC_LIGHTMAP_RULES } from '../contracts/volumetricLightmapOptions.ts'
import { SHADOW_RULES } from '../contracts/shadowOptions.ts'
import { MOTION_BLUR_RULES } from '../contracts/motionBlurOptions.ts'
import { BLOOM_RULES } from '../contracts/bloomRules.ts'
import { GAUSSIAN_BLUR_RULES } from '../contracts/gaussianBlurRules.ts'
import { FILM_RULES } from '../contracts/filmOptions.ts'
import { COLOR_GRADING_RULES } from '../contracts/colorGradingOptions.ts'
import { VOLUMETRIC_FOG_RULES } from '../contracts/volumetricFogOptions.ts'
import { SINGLE_LAYER_WATER_RULES } from '../contracts/singleLayerWaterOptions.ts'
import { SUBSURFACE_SCATTERING_RULES } from '../contracts/subsurfaceScatteringOptions.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../contracts/translucencyVolumeOptions.ts'
import { TRANSLUCENCY_GI_RULES } from '../contracts/translucencyGiOptions.ts'
import { SCREEN_PROBE_RULES } from '../bounce/screenProbeOptions.ts'
import { REFLECTION_RULES } from '../contracts/reflectionOptions.ts'
import { MESH_DISTANCE_FIELD_TRACE_RULES } from '../contracts/meshDistanceFieldTraceOptions.ts'
import { LIGHTING_DATA_FORMAT_RULES } from '../contracts/lightingDataFormatOptions.ts'
import { RAY_TRACING_RULES } from '../contracts/rayTracingOptions.ts'
import { SCREEN_SPACE_TRACING_RULES } from '../contracts/screenSpaceTracingOptions.ts'
import { SURFACE_CACHE_RULES } from '../contracts/surfaceCacheOptions.ts'
import { RASTER_RULES } from '../contracts/rasterOptions.ts'
import { AMBIENT_OCCLUSION_RULES } from '../contracts/ambientOcclusionOptions.ts'
import { AMBIENT_CUBEMAP_RULES } from '../contracts/ambientCubemapOptions.ts'
import { REFLECTION_CAPTURE_RULES } from '../contracts/reflectionCaptureOptions.ts'
import { TESSELLATION_RULES } from '../contracts/tessellationOptions.ts'
import { TEXTURE_FILTERING_RULES } from '../contracts/textureFilteringOptions.ts'
import { DEPTH_OF_FIELD_RULES } from '../contracts/depthOfFieldRules.ts'
import { EXPOSURE_RULES } from '../contracts/exposureOptions.ts'
import { SKY_QUALITY_RULES } from '../modules/sky/quality.ts'
import { HAIR_STRANDS_RULES } from '../contracts/hairStrandsOptions.ts'
import { CUSTOM_DEPTH_RULES } from '../contracts/customDepthOptions.ts'
import { POST_PROCESS_MATERIAL_RULES } from '../contracts/postProcessMaterialOptions.ts'
import { HETEROGENEOUS_VOLUME_RULES } from '../contracts/heterogeneousVolumeOptions.ts'

const validate = new Ajv({ allErrors: true }).compile(EXPLORER_OPTIONS_SCHEMA)
const explorer = { manifestUrl: '/assets/model/manifest.json' }

test('explorer arguments accept a complete host request and keep host extensions', () => {
  assert.equal(
    validate({
      ...explorer,
      interactive: true,
      scope: 'full',
      geometryPoolBytes: 134217728,
      texturePoolBytes: 134217728,
      maxTextureUploadMsPerFrame: 2,
      temporalAntialiasing: false,
      pixelError: 1.5,
      bounce: true,
      importedLights: false,
      preload: 'all',
      stageProfile: true,
      diagnosticDetail: 'trace',
      replicaCount: 4,
      clearColor: 0x123456,
      hostExtension: 'kept',
    }),
    true,
  )
})

test('explorer arguments name every choice the engine takes and refuse the rest', () => {
  assert.equal(validate({}), false)
  assert.equal(validate({ manifestUrl: false }), false)
  for (const field of [
    'interactive',
    'temporalAntialiasing',
    'bounce',
    'importedLights',
    'stageProfile',
  ])
    assert.equal(validate({ ...explorer, [field]: 'true' }), false, field)
  for (const field of ['scope', 'preload', 'diagnosticDetail'])
    assert.equal(validate({ ...explorer, [field]: 'unknown' }), false, field)
  for (const patch of [
    { geometryPoolBytes: 1 },
    { geometryPoolBytes: 'bytes' },
    { texturePoolBytes: 1 },
    { texturePoolBytes: 67108864.5 },
    { maxTextureUploadMsPerFrame: -1 },
    { maxTextureUploadMsPerFrame: 17 },
    { pixelError: -1 },
    { pixelError: 'pixels' },
    { replicaCount: 2 },
    { replicaCount: '4' },
    { clearColor: 0.5 },
  ])
    assert.equal(validate({ ...explorer, ...patch }), false, JSON.stringify(patch))
})

test('an explorer request naming only its manifest is completed with the engine defaults', () => {
  const request: Record<string, unknown> = { ...explorer }
  assert.equal(
    new Ajv({ allErrors: true, useDefaults: true }).compile(EXPLORER_OPTIONS_SCHEMA)(request),
    true,
  )
  assert.equal(request.geometryPoolBytes, DEFAULT_GEOMETRY_POOL_BUDGET)
  assert.equal(request.texturePoolBytes, DEFAULT_TEXTURE_POOL_BUDGET)
  assert.equal(request.maxTextureUploadMsPerFrame, DEFAULT_TEXTURE_UPLOAD_MS)
  for (const [key, property] of Object.entries(EXPLORER_OPTIONS_SCHEMA.properties)) {
    if (property.default === undefined) continue
    assert.notEqual(request[key], undefined, key)
    // Each default, alone, passes the checks of its own field.
    assert.equal(validate({ ...explorer, [key]: request[key] }), true, key)
  }
})

test('a switch the host leaves out is set in the engine as the schema advertises it', () => {
  // Each setting family (the raster's, the world streaming's, the cut's, … the exposure's and the
  // sky's quality) is read by its contract's one resolver; every other switch is the explorer's.
  const rules: Readonly<Record<string, SettingRule>> = {
    ...RASTER_RULES,
    ...WORLD_STREAMING_RULES,
    ...CUT_RULES,
    ...DYNAMIC_RESOLUTION_RULES,
    ...ANIMATION_RULES,
    ...TEMPORAL_RULES,
    ...HIZ_RULES,
    ...LIGHT_FUNCTION_RULES,
    ...LIGHT_PROFILE_RULES,
    ...SEPARATE_TRANSLUCENCY_RULES,
    ...RECT_LIGHT_ATLAS_RULES,
    ...SIMPLE_LIGHT_RULES,
    ...GLOBAL_DISTANCE_FIELD_RULES,
    ...DISTANCE_FIELD_OCCLUSION_RULES,
    ...VOLUMETRIC_LIGHTMAP_RULES,
    ...SHADOW_RULES,
    ...MOTION_BLUR_RULES,
    ...BLOOM_RULES,
    ...GAUSSIAN_BLUR_RULES,
    ...FILM_RULES,
    ...COLOR_GRADING_RULES,
    ...VOLUMETRIC_FOG_RULES,
    ...TRANSLUCENCY_VOLUME_RULES,
    ...TRANSLUCENCY_GI_RULES,
    ...SUBSURFACE_SCATTERING_RULES,
    ...SINGLE_LAYER_WATER_RULES,
    ...HAIR_STRANDS_RULES,
    ...CUSTOM_DEPTH_RULES,
    ...POST_PROCESS_MATERIAL_RULES,
    ...HETEROGENEOUS_VOLUME_RULES,
    ...SAMPLED_LIGHTS_RULES,
    ...PATH_TRACING_RULES,
    ...SCREEN_PROBE_RULES,
    ...REFLECTION_RULES,
    ...SCREEN_SPACE_TRACING_RULES,
    ...MESH_DISTANCE_FIELD_TRACE_RULES,
    ...LIGHTING_DATA_FORMAT_RULES,
    ...RAY_TRACING_RULES,
    ...SURFACE_CACHE_RULES,
    ...AMBIENT_OCCLUSION_RULES,
    ...AMBIENT_CUBEMAP_RULES,
    ...REFLECTION_CAPTURE_RULES,
    ...TESSELLATION_RULES,
    ...TEXTURE_FILTERING_RULES,
    ...DEPTH_OF_FIELD_RULES,
    ...EXPOSURE_RULES,
    ...SKY_QUALITY_RULES,
    ...SHADING_RULES,
  }
  const advertised = Object.entries(EXPLORER_OPTIONS_SCHEMA.properties).filter(
    ([, property]) => property.type === 'boolean' && property.default !== undefined,
  )
  const switches = advertised.filter(([key]) => !(key in rules))
  assert.deepEqual(switches.map(([key]) => key).sort(), [...EXPLORER_SWITCH_NAMES].sort())
  for (const [key, property] of switches)
    assert.equal(explorerSwitch({}, key as ExplorerSwitch), property.default, key)
  for (const [key, property] of advertised.filter(([key]) => key in rules))
    assert.equal(resolveSetting(rules[key]), property.default, key)
})

// No pool ceiling: the drawable-page tables start at the pool and grow in place past it.
test('the schema advertises no geometry pool ceiling', () => {
  assert.equal(EXPLORER_OPTIONS_SCHEMA.properties.geometryPoolCeilingBytes, undefined)
})

test('a level setting takes its names, true for its default and false for off, as the anti-aliasing level does', () => {
  for (const key of [
    'screenProbes',
    'motionBlurQuality',
    'volumetricFogQuality',
    'chromaticAberrationQuality',
  ] as const) {
    for (const value of [true, false, 'off'])
      assert.equal(validate({ ...explorer, [key]: value }), true, `${key} ${String(value)}`)
    assert.equal(validate({ ...explorer, [key]: 'extreme' }), false, key)
    assert.equal(validate({ ...explorer, [key]: 3 }), false, key)
  }
})

test('the depth of field level is the switch the reference reads: on or off, true for on and false for off', () => {
  const key = 'depthOfFieldQuality'
  for (const value of [true, false, 'off', 'on'])
    assert.equal(validate({ ...explorer, [key]: value }), true, `${key} ${String(value)}`)
  for (const value of ['high', 'extreme', 3, null])
    assert.equal(validate({ ...explorer, [key]: value }), false, `${key} ${String(value)}`)
  assert.equal(EXPLORER_OPTIONS_SCHEMA.properties.depthOfFieldGatherDivisor.default, 2)
  assert.equal(EXPLORER_OPTIONS_SCHEMA.properties.depthOfFieldTemporalQuality.default, 'high')
})
