// The shadow settings read by their rules: the sun's distance, its far-shadow edge and distance-field
// cascade follow the light's own settings, the view's and the quality levels; the shadow maps' own
// (`shadowMapOptions.ts`: clipmap levels, coarse pages, resolution biases, a trace's
// rays and steps, the page pool) take the numbers of the reference's scalability rows.
import test from 'node:test'
import assert from 'node:assert/strict'

import { QUALITY_LEVELS } from '../runtime/qualityLevels.ts'
import { resolveSetting, resolveSettings } from './settingRules.ts'
import {
  LIGHT_SHADOW_RULES,
  resolveLightShadow,
  SHADOW_DISTANCE_DEFAULT,
  type LightShadowOptions,
} from './lightShadowOptions.ts'
import { presetShadows } from './shadowOptions.fixture.ts'
import {
  readShadowSetting,
  SHADOW_GEOMETRY_LOD_BIAS_LIMIT,
  SHADOW_PRESET_LEVELS,
  SHADOW_RULES,
} from './shadowOptions.ts'

/** The shadow maps' own settings at their defaults, the reference's fourth row. */
const SHADOW_MAP_DEFAULTS = {
  ...{ shadowClipmapFirstLevel: 6, shadowClipmapLastLevel: 22 },
  ...{ shadowClipmapFirstCoarseLevel: 15, shadowClipmapLastCoarseLevel: 18 },
  ...{ shadowClipmapZRangeScale: 1000, shadowMarkCoarsePagesDirectional: 2 },
  shadowClipmapMinCameraViewportWidth: 0,
  ...{ shadowOrthoEstimateClipmapLevels: true, shadowOrthoClipmapLodBias: 0 },
  ...{ shadowOrthoProjectViewOrigin: true, shadowOrthoRayCastViewOrigin: true },
  ...{ shadowClipmapWpoDisableDistance: true, shadowClipmapWpoDisableDistanceLodBias: 3 },
  ...{ shadowClipmapWpoDisableDistanceInvalidateOnScaleChange: false },
  ...{ shadowClipmapCullDynamicTightly: true, shadowForceInvalidateDirectional: false },
  ...{ shadowPrefilteredDistant: false, shadowPrefilteredDistantHistoryBlendFactor: 0.87 },
  ...{ shadowMarkCoarsePagesLocal: 1, shadowResolutionLodBiasDirectional: -1.5 },
  ...{ shadowResolutionLodBiasDirectionalMoving: -1.5, shadowResolutionLodBiasLocal: 0 },
  ...{ shadowResolutionLodBiasLocalMoving: 1, shadowLightActiveFrameCount: 10 },
  ...{ shadowRayCountDirectional: 8, shadowSamplesPerRayDirectional: 4 },
  ...{ shadowRayCountLocal: 8, shadowSamplesPerRayLocal: 4, shadowMaxPhysicalPages: 4096 },
  ...{ shadowDistantLightMode: 1, shadowMaxDistantUpdatePerFrame: 1 },
  ...{ shadowVirtualEnable: true },
  ...{ shadowCsmMaxCascades: 10 },
  ...{ shadowCsmTransitionScale: 1 },
  ...{ shadowMaxCsmResolution: 2048 },
  ...{ shadowCsmDepthBias: 10 },
  ...{ shadowCsmSlopeScaleDepthBias: 3 },
  ...{ shadowCsmReceiverBias: 0.9 },
  ...{ shadowCsmSplitPenumbraScale: 0.5 },
  ...{ shadowTransitionScale: 60 },
  ...{ shadowPointLightDepthBias: 0.02 },
  ...{ shadowPointLightSlopeScaleDepthBias: 3 },
  ...{ shadowSpotLightDepthBias: 3 },
  ...{ shadowSpotLightSlopeScaleDepthBias: 3 },
  ...{ shadowSpotLightTransitionScale: 60 },
  ...{ shadowMaxSlopeScaleDepthBias: 1 },
  ...{ shadowSpotLightReceiverBias: 0.5 },
  ...{ shadowPointLightShadows: true, shadowPointLightCubemaps: true },
  ...{ shadowResolutionScaleZeroDisables: true, shadowMaxResolution: 2048 },
  ...{ shadowFadeResolution: 64, shadowMinResolution: 32, shadowFadeExponent: 0.25 },
  ...{ shadowFadeUsesResolutionScale: true, shadowTexelsPerPixelPoint: 1.27324 },
  ...{ shadowTexelsPerPixelSpot: 2.54648, shadowTexelsPerPixelRect: 1.27324 },
  ...{ shadowQuality: 5, shadowTranslucentQuality: 0, shadowTranslucentLocalLights: false },
  ...{ shadowCoarsePagePixelThresholdStatic: 1, shadowCoarsePagePixelThresholdDynamicClusters: 4 },
  shadowCoarsePagesIncludeNonClusterCasters: true,
  ...{ shadowPageDilationBorderSizeDirectional: 0.05, shadowPageDilationBorderSizeLocal: 0.05 },
  ...{
    shadowCullBackfacingPixels: true,
    shadowMarkPagesUseFroxels: false,
    shadowMarkPixelPages: true,
    shadowPageMarkingPixelStrideX: 2,
    shadowMarkPixelPagesMipModeLocal: 0,
  },
  ...{ shadowPageMarkingPixelStrideY: 2, shadowNormalBias: 0.5, shadowScreenRayLength: 0.015 },
  shadowRasterIndirectionMultiplier: 1.5,
  ...{ shadowCacheInvalidateUseHzb: true, shadowDeferredInvalidationBudget: -1 },
  ...{ shadowCache: true, shadowCacheAllocateViaLru: true, shadowCacheWpoPrimitives: false },
  shadowForceInvalidateLocal: 0,
  ...{ shadowForceFullPageClears: false, shadowUseReceiverMaskDirectional: true },
  ...{ shadowCacheDebugSkipDynamicPageInvalidation: false, shadowDynamicDeallocationMode: 0 },
  shadowUseReceiverMaskLocal: false,
  shadowFirstPersonClipmap: true,
  shadowFirstPersonClipmapFirstLevel: 8,
  shadowFirstPersonClipmapLastLevel: 18,
  shadowFirstPersonPixelRequestBias: 2,
  shadowFirstPersonRequestMinLevelClamp: 8,
  shadowSubsurfaceMinSourceAngle: 5,
  shadowOnePassProjection: true,
  clusteredDeferredShading: true,
  shadowForcePerLightMaskClear: false,
  shadowOnePassProjectionMaxLightsPerPixel: 16,
  shadowAllowScreenOverflowMessages: true,
  shadowMaxDofResolutionBias: 1,
  shadowInvalidateOnLodDelta: false,
  ...{ shadowCacheFramesStaticThreshold: 100, shadowCacheMaxPageAgeSinceLastRequest: 1000 },
  ...{ shadowCacheMaxLightAgeSinceLastRequest: 10, shadowDynamicResolutionMaxResolutionLodBias: 2 },
  ...{ shadowDynamicResolutionMaxPagePoolLoadFactor: 0.85, shadowSmrtAdaptiveRayCount: 1 },
  ...{ shadowDynamicResolutionTimeBudgetMs: 0, shadowDynamicResolutionLoadBudget: 0 },
  shadowDynamicResolutionPerVsmBiasHistoryWeight: 0.9,
  ...{ shadowDynamicResolutionMaxComputeResolutionLodBiasDirectional: 99999 },
  ...{ shadowDynamicResolutionMaxComputeResolutionLodBiasLocal: 99999 },
  ...{ shadowSmrtMaxRayAngleFromLight: 0.03, shadowSmrtExtrapolateMaxSlopeLocal: 0.05 },
  ...{ shadowSmrtExtrapolateMaxSlopeDirectional: 5, shadowSmrtTexelDitherScaleLocal: 2 },
  ...{ shadowSmrtTexelDitherScaleDirectional: 2, shadowSmrtMaxSlopeBiasLocal: 50 },
  shadowSmrtRayLengthScaleDirectional: 1.5,
  translucentRectLights: false,
  ...{ lightMinScreenRadius: 0.03, lightMaxDrawDistanceScale: 1 },
  lightDrawRangeFollowsFieldOfView: true,
}

/** The view's far-shadow settings at their defaults. */
const SUN_SHADOW_DEFAULTS = {
  ...{ shadowMaxFarCascades: 10, shadowFarDistanceOverride: 0, distanceFieldDistanceScale: 1 },
  ...{ distanceFieldShadowQuality: 3, distanceFieldShadowing: true },
  ...{ distanceFieldShadowTileSize: 2, distanceFieldShadowTwoSidedBias: 1 },
  ...{ distanceFieldShadowObjectsPerTile: 128, distanceFieldShadowCompactTiles: true },
  distanceFieldShadowSnapResolution: 2048,
}

/** The view's contact shadow settings at their defaults: on, no override of the lights' own. */
const CONTACT_SHADOW_DEFAULTS = {
  ...{ contactShadows: true, contactShadowOverrideLength: -1 },
  ...{ contactShadowOverrideLengthInWorldSpace: false, contactShadowOverrideCastingIntensity: -1 },
  contactShadowOverrideNonCastingIntensity: -1,
  ...{
    contactShadowMethod: 0,
    contactShadowBendSurfaceThickness: 0.005,
    contactShadowBendMaxLights: 8,
    contactShadowIntensityMode: 0,
  },
  ...{ contactShadowIntensityFadeStart: 1600, contactShadowIntensityFadeLength: 800 },
}

/** The view's capsule shadow settings at their defaults. */
const CAPSULE_SHADOW_DEFAULTS = {
  ...{ capsuleShadows: true, capsuleDirectShadows: true, capsuleIndirectShadows: true },
  ...{ capsuleShadowsFullResolution: false, capsuleMaxDirectOcclusionDistance: 4 },
  ...{ capsuleMaxIndirectOcclusionDistance: 2, capsuleShadowFadeAngleFromVertical: Math.PI / 3 },
  ...{ capsuleIndirectConeAngle: Math.PI / 8, capsuleSkyAngleScale: 0.6, capsuleMinSkyAngle: 15 },
  capsuleIndirectSelfShadowingIntensity: 0.8,
}

test('the shadow settings read by their rules, a light’s own beside them', () => {
  assert.deepEqual(resolveSettings(SHADOW_RULES, {}), {
    ...{ shadowDistanceScale: 1, farShadowCulling: true },
    ...{ shadowNearLevels: 10, shadowOverlapScale: 1, shadowFarField: true },
    ...{ shadowMultipassViews: true, ...SUN_SHADOW_DEFAULTS, ...SHADOW_MAP_DEFAULTS },
    ...CONTACT_SHADOW_DEFAULTS,
    ...CAPSULE_SHADOW_DEFAULTS,
    ...{
      shadowGeometryLodBias: 1,
      shadowOcclusionCulling: true,
      shadowOcclusionFullUpdate: false,
      shadowDynamicHzb: false,
    },
  })
  assert.deepEqual(resolveLightShadow({}), {
    ...{ shadowDistance: 400, shadowCascades: 4, shadowCascadeExponent: 3 },
    ...{ shadowCascadeTransition: 0.1, farShadowCascades: 0, farShadowDistance: 3000 },
    ...{ distanceFieldShadows: true, distanceFieldShadowDistance: 512 },
  })
  assert.equal(SHADOW_DISTANCE_DEFAULT, 400)
  assert.equal(resolveSetting(SHADOW_RULES.shadowDistanceScale, 2), 2)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowDistanceScale, 2.1), /from 0 to 2/)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowDistanceScale, -0.1), /from 0 to 2/)
  assert.throws(() => resolveSetting(SHADOW_RULES.farShadowCulling, 1 as never), /true or false/)
  const passes = SHADOW_RULES.shadowMultipassViews // a switch, on by default, and nothing else
  assert.throws(() => resolveSetting(passes, 0 as never), /true or false/)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowNearLevels, 11), /from 0 to 10/)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowNearLevels, 1.5), /whole/)
  assert.throws(() => resolveSetting(SHADOW_RULES.shadowOverlapScale, 2.1), /from 0 to 2/)
  const refuses = (field: keyof typeof SUN_SHADOW_DEFAULTS, value: unknown, words: RegExp) =>
    assert.throws(() => resolveSetting(SHADOW_RULES[field], value as never), words, field)
  refuses('distanceFieldDistanceScale', 0, /from 0.0001 to 10000/)
  refuses('distanceFieldShadowQuality', 4, /from 0 to 3/)
  refuses('distanceFieldShadowTileSize', 0, /above 0/)
  refuses('shadowMaxFarCascades', -1, /at least 0/)
  refuses('distanceFieldShadowObjectsPerTile', 0, /at least 1/)
  refuses('distanceFieldShadowCompactTiles', 'yes', /true or false/)
  refuses('distanceFieldShadowSnapResolution', 31, /from 32 to/)
  refuses('distanceFieldShadowSnapResolution', 64.5, /whole/)
  // A light's own: a distance takes true, false and metres; the rest what its rule says.
  const light = (options: LightShadowOptions) => resolveLightShadow(options)
  assert.deepEqual(
    [true, false, 0, 90.5].map((value) => light({ shadowDistance: value }).shadowDistance),
    [400, 0, 0, 90.5],
  )
  assert.equal(light({ distanceFieldShadowDistance: false }).distanceFieldShadowDistance, 0)
  for (const bad of [-1, NaN, Infinity, '400', {}])
    assert.throws(() => light({ shadowDistance: bad as never }), /shadowDistance: must be a finite/)
  assert.throws(() => light({ shadowCascades: 1.5 }), /shadowCascades: must be a whole number/)
  assert.throws(() => light({ shadowCascadeExponent: -1 }), /at least 0/)
  assert.throws(() => resolveLightShadow({ shadowDistanse: 1 }), /no field shadowDistanse/)
  assert.equal(LIGHT_SHADOW_RULES.shadowDistance.distance, true)
})

test('a runtime’s context reads a shadow setting through the contract’s one reader', () => {
  assert.equal(readShadowSetting({ context: {} }, 'shadowNearLevels'), 10)
  assert.equal(readShadowSetting({ context: { shadowNearLevels: 3 } }, 'shadowNearLevels'), 3)
  assert.equal(readShadowSetting({ context: { shadowQuality: null } }, 'shadowQuality'), 5)
})

/** The reference's scalability rows of the shadow maps' settings: smooth, balanced, fine. */
const ROWS = {
  shadowMarkCoarsePagesLocal: [2, 2, 2],
  shadowResolutionLodBiasDirectional: [0, 0, 0],
  shadowResolutionLodBiasDirectionalMoving: [0, 0, 0],
  shadowResolutionLodBiasLocal: [1, 1, 0],
  shadowResolutionLodBiasLocalMoving: [2, 2, 1],
  shadowRayCountDirectional: [0, 4, 8],
  shadowSamplesPerRayDirectional: [2, 2, 4],
  shadowRayCountLocal: [0, 4, 4],
  shadowSamplesPerRayLocal: [2, 2, 4],
  shadowMaxPhysicalPages: [512, 512, 2048],
  shadowMaxResolution: [512, 1024, 1024],
  // The first level turns every shadow off, the second keeps a middle level, the third the top.
  shadowQuality: [0, 3, 5],
} as const

test('the shadow maps’ settings take the rows of the first three quality levels, the fourth the defaults', () => {
  const levels = ['smooth', 'balanced', 'fine'] as const
  for (const field of Object.keys(SHADOW_MAP_DEFAULTS) as (keyof typeof SHADOW_MAP_DEFAULTS)[]) {
    const row = (ROWS as Record<string, readonly number[]>)[field]
    for (const [k, level] of levels.entries())
      assert.equal(
        presetShadows(level)[field],
        row ? row[k] : SHADOW_MAP_DEFAULTS[field],
        `${level} ${field}: ${row ? 'its row' : 'no level writes it'}`,
      )
  }
  assert.deepEqual(presetShadows('max'), resolveSettings(SHADOW_RULES, {}), 'max writes nothing')
})

test('the shadow maps’ settings refuse what they cannot take, in words', () => {
  const refuses = (field: keyof typeof SHADOW_MAP_DEFAULTS, value: unknown, words: RegExp) =>
    assert.throws(() => resolveSetting(SHADOW_RULES[field], value as never), words, field)
  refuses('shadowMarkCoarsePagesLocal', 3, /from 0 to 2/)
  refuses('shadowMarkCoarsePagesDirectional', 0.5, /whole/)
  refuses('shadowRayCountLocal', 17, /from 0 to 16/)
  refuses('shadowRayCountDirectional', 1.5, /whole/)
  refuses('shadowSamplesPerRayLocal', 65, /from 0 to 64/)
  refuses('shadowClipmapLastLevel', 31, /from 0 to 30/)
  refuses('shadowClipmapZRangeScale', 0, /above 0/)
  refuses('shadowClipmapMinCameraViewportWidth', 16385, /from 0 to 16384/)
  refuses('shadowClipmapMinCameraViewportWidth', 0.5, /whole/)
  refuses('shadowOrthoEstimateClipmapLevels', 1, /true or false/)
  refuses('shadowOrthoClipmapLodBias', 31, /from -30 to 30/)
  refuses('shadowOrthoClipmapLodBias', 0.5, /whole/)
  refuses('shadowOrthoProjectViewOrigin', 1, /true or false/)
  refuses('shadowOrthoRayCastViewOrigin', 1, /true or false/)
  refuses('shadowClipmapWpoDisableDistance', 1, /true or false/)
  refuses('shadowClipmapWpoDisableDistanceLodBias', 31, /from 0 to 30/)
  refuses('shadowClipmapWpoDisableDistanceInvalidateOnScaleChange', 1, /true or false/)
  refuses('shadowClipmapCullDynamicTightly', 1, /true or false/)
  refuses('shadowForceInvalidateDirectional', 1, /true or false/)
  refuses('shadowPrefilteredDistant', 1, /true or false/)
  refuses('shadowPrefilteredDistantHistoryBlendFactor', 1.5, /from 0 to 1/)
  refuses('shadowCache', 0, /true or false/)
  refuses('shadowCacheAllocateViaLru', 1, /true or false/)
  refuses('shadowCacheWpoPrimitives', 1, /true or false/)
  refuses('shadowForceInvalidateLocal', 3, /from 0 to 2/)
  refuses('shadowForceInvalidateLocal', 0.5, /whole/)
  refuses('shadowForceFullPageClears', 1, /true or false/)
  refuses('shadowCacheDebugSkipDynamicPageInvalidation', 1, /true or false/)
  refuses('shadowDynamicDeallocationMode', 3, /from 0 to 2/)
  refuses('shadowDynamicDeallocationMode', 0.5, /whole/)
  refuses('shadowMarkPixelPages', 1, /true or false/)
  refuses('shadowUseReceiverMaskDirectional', 1, /true or false/)
  refuses('shadowUseReceiverMaskLocal', 1, /true or false/)
  refuses('shadowLightActiveFrameCount', 0, /at least 1/)
  refuses('shadowMaxPhysicalPages', 0, /at least 1/)
  refuses('shadowDistantLightMode', 3, /from 0 to 2/)
  refuses('shadowMaxDistantUpdatePerFrame', -2, /from -1/)
  refuses('shadowMaxResolution', 0, /from 1 to 8192/)
  for (const field of ['shadowMinResolution', 'shadowTexelsPerPixelRect'] as const)
    refuses(field, -1, /at least 0/)
  for (const field of [
    'shadowDynamicResolutionTimeBudgetMs',
    'shadowDynamicResolutionLoadBudget',
    'shadowDynamicResolutionMaxComputeResolutionLodBiasDirectional',
    'shadowDynamicResolutionMaxComputeResolutionLodBiasLocal',
  ] as const)
    refuses(field, -1, /at least 0/)
  // The map bias's history weight is the reference's free number: beyond 0 to 1 is taken as given.
  for (const weight of [-0.5, 1.5])
    assert.equal(
      resolveSetting(SHADOW_RULES.shadowDynamicResolutionPerVsmBiasHistoryWeight, weight),
      weight,
    )
  refuses('shadowPointLightCubemaps', 1, /true or false/)
  refuses('shadowResolutionLodBiasLocal', 17, /from -16 to 16/)
  for (const quality of [6, -1]) refuses('shadowQuality', quality, /from 0 to 5/)
  refuses('shadowQuality', 2.5, /whole/)
  const limit = SHADOW_GEOMETRY_LOD_BIAS_LIMIT
  for (const bias of [limit + 1, -limit - 1, Infinity])
    refuses('shadowGeometryLodBias' as never, bias, new RegExp(`from -${limit} to ${limit}`))
  // The ends are taken; 17 rays, one more than a mask lane holds, is refused above; the quality's
  // (0 turns every shadow off); a bias of 20 (within its one bound, `SHADOW_GEOMETRY_LOD_BIAS_LIMIT`).
  assert.equal(resolveSetting(SHADOW_RULES.shadowRayCountLocal, 16), 16)
  assert.equal(resolveSetting(SHADOW_RULES.shadowResolutionLodBiasDirectional, -16), -16)
  assert.equal(resolveSetting(SHADOW_RULES.shadowMaxDistantUpdatePerFrame, -1), -1, 'all of them')
  assert.deepEqual(
    [0, 5].map((q) => resolveSetting(SHADOW_RULES.shadowQuality, q)),
    [0, 5],
  )
  assert.equal(resolveSetting(SHADOW_RULES.shadowGeometryLodBias, 20), 20)
})

test('the quality levels write the shadow rules’ own rows, each a shadow setting, and the top level none', () => {
  for (const level of ['smooth', 'balanced', 'fine'] as const) {
    const row = SHADOW_PRESET_LEVELS[level]
    assert.ok(
      Object.keys(row).every((f) => f in SHADOW_RULES),
      `${level}: rules only`,
    )
    // The table holds the row whole; what it adds beside it is the fog's, no shadow setting.
    const written = Object.entries(QUALITY_LEVELS.shadows[level]).filter(([f]) => f in SHADOW_RULES)
    assert.deepEqual(Object.fromEntries(written), row, level)
  }
  assert.deepEqual(QUALITY_LEVELS.shadows.max, {})
})
