import {
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
} from './settingRules.ts'

/**
 * THE SHADOW MAPS' OWN SETTINGS (`shadowOptions.ts` lists them with the sun's): each a setting with
 * the reference's number and the rows of its quality levels — `smooth` the first scalability level,
 * `balanced` the second, `fine` the third, `max` the fourth, which is the default and writes nothing
 * (so the default preset reads every setting at its default). Where the reference's own default is
 * another number than the fourth row's, the setting's default is the row's.
 *
 * | setting | default | smooth balanced fine |
 * |---|---|---|
 * | `shadowClipmapFirstLevel` | 6 | |
 * | `shadowClipmapLastLevel` | 22 | |
 * | `shadowClipmapFirstCoarseLevel` | 15 | |
 * | `shadowClipmapLastCoarseLevel` | 18 | |
 * | `shadowClipmapZRangeScale` | 1000 | |
 * | `shadowMarkCoarsePagesDirectional` | 2 | |
 * | `shadowMarkCoarsePagesLocal` | 1 | 2 2 2 |
 * | `shadowResolutionLodBiasDirectional` | -1.5 | 0 0 0 |
 * | `shadowResolutionLodBiasDirectionalMoving` | -1.5 | 0 0 0 |
 * | `shadowResolutionLodBiasLocal` | 0 | 1 1 0 |
 * | `shadowResolutionLodBiasLocalMoving` | 1 | 2 2 1 |
 * | `shadowLightActiveFrameCount` | 10 | |
 * | `shadowRadiusThreshold` | 0.01 | 0.06 0.05 0.04 |
 * | `shadowRadiusThresholdUncached` | true | |
 * | `shadowRayCountDirectional` | 8 | 0 4 8 |
 * | `shadowSamplesPerRayDirectional` | 4 | 2 2 4 |
 * | `shadowRayCountLocal` | 8 | 0 4 4 |
 * | `shadowSamplesPerRayLocal` | 4 | 2 2 4 |
 * | `shadowMaxPhysicalPages` | 4096 | 512 512 2048 |
 *
 * `shadowMaxPhysicalPages` is the most pages the pool takes; the pool holds at most one window of
 * 2048 pages (`VSM_POOL_PAGES`, the 128 MiB binding every device grants and a forward reader
 * binds), so a value past it reads as 2048: the fourth row's 4096 is the window's. A light traces at
 * most 15 rays: a pixel's shadow lane holds its ray count and its missed rays in a nibble each.
 */
export const SHADOW_MAP_RULES = [
  integer('shadowClipmapFirstLevel', 6, [0, 30]),
  integer('shadowClipmapLastLevel', 22, [0, 30]),
  integer('shadowClipmapFirstCoarseLevel', 15, [0, 30]),
  integer('shadowClipmapLastCoarseLevel', 18, [0, 30]),
  positive('shadowClipmapZRangeScale', 1000, 'a finite number above 0'),
  integer('shadowMarkCoarsePagesDirectional', 2, [0, 2]),
  integer('shadowMarkCoarsePagesLocal', 1, [0, 2]),
  number('shadowResolutionLodBiasDirectional', -1.5, [-16, 16]),
  number('shadowResolutionLodBiasDirectionalMoving', -1.5, [-16, 16]),
  number('shadowResolutionLodBiasLocal', 0, [-16, 16]),
  number('shadowResolutionLodBiasLocalMoving', 1, [-16, 16]),
  count('shadowLightActiveFrameCount', 10, 1),
  nonNegative('shadowRadiusThreshold', 0.01),
  flag('shadowRadiusThresholdUncached', true),
  integer('shadowRayCountDirectional', 8, [0, 15]),
  integer('shadowSamplesPerRayDirectional', 4, [0, 64]),
  integer('shadowRayCountLocal', 8, [0, 15]),
  integer('shadowSamplesPerRayLocal', 4, [0, 64]),
  count('shadowMaxPhysicalPages', 4096, 1),
] as const

/** The fields `SHADOW_MAP_RULES` names. */
export type ShadowMapField = (typeof SHADOW_MAP_RULES)[number]['field']

/** What the quality levels below the top one write of those settings: the rows of the reference's
 *  first three scalability levels; `max` writes nothing (`runtime/qualityLevels.ts`). */
export const SHADOW_MAP_PRESET_LEVELS = {
  smooth: {
    ...{ shadowMarkCoarsePagesLocal: 2, shadowResolutionLodBiasDirectional: 0 },
    ...{ shadowResolutionLodBiasDirectionalMoving: 0, shadowResolutionLodBiasLocal: 1 },
    ...{ shadowResolutionLodBiasLocalMoving: 2, shadowRadiusThreshold: 0.06 },
    ...{ shadowRayCountDirectional: 0, shadowSamplesPerRayDirectional: 2 },
    ...{ shadowRayCountLocal: 0, shadowSamplesPerRayLocal: 2, shadowMaxPhysicalPages: 512 },
  },
  balanced: {
    ...{ shadowMarkCoarsePagesLocal: 2, shadowResolutionLodBiasDirectional: 0 },
    ...{ shadowResolutionLodBiasDirectionalMoving: 0, shadowResolutionLodBiasLocal: 1 },
    ...{ shadowResolutionLodBiasLocalMoving: 2, shadowRadiusThreshold: 0.05 },
    ...{ shadowRayCountDirectional: 4, shadowSamplesPerRayDirectional: 2 },
    ...{ shadowRayCountLocal: 4, shadowSamplesPerRayLocal: 2, shadowMaxPhysicalPages: 512 },
  },
  fine: {
    ...{ shadowMarkCoarsePagesLocal: 2, shadowResolutionLodBiasDirectional: 0 },
    ...{ shadowResolutionLodBiasDirectionalMoving: 0, shadowResolutionLodBiasLocal: 0 },
    ...{ shadowResolutionLodBiasLocalMoving: 1, shadowRadiusThreshold: 0.04 },
    ...{ shadowRayCountDirectional: 8, shadowSamplesPerRayDirectional: 4 },
    ...{ shadowRayCountLocal: 4, shadowSamplesPerRayLocal: 4, shadowMaxPhysicalPages: 2048 },
  },
} as const
