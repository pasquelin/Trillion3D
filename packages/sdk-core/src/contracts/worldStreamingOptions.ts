import {
  choiceSetting as choice,
  countSetting as count,
  flagSetting as flag,
  INT32_RANGE,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  resolveSettingsInto,
  rulesOf,
  type RulesByField,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The run-time settings of a partitioned scene's streaming: how the view, the scene's one
 * streaming source, wishes the cells of each grid and the order they load in, whether a load
 * blocks on slow streaming and whether the HLOD actors load (`WORLD_STREAMING_SETTINGS`,
 * `packages/sdk-browser/src/geometry/partition/source.ts`, `slowStreaming.ts` beside it), how far
 * the view must move before the cells are wished again (`streamingUpdate.ts` beside it), and the
 * warm-up a switch that draws an HLOD actor waits on (`HLOD_WARMUP_SETTINGS`,
 * `packages/sdk-browser/src/frame/prepare/hlodWarm.ts`). Run-time settings, as `./settingRules.ts`
 * says.
 */

/** How many cells may load at once: a whole number a 32-bit counter holds; 0 or less lifts the
 *  limit, every cell wished starting at once. */
const LOADING_CELLS: readonly [number, number] = INT32_RANGE

/** The view's streaming settings, by the name the partition reads them by, each with the
 *  reference's default: 4 cells loading at once, an angle weight of 0.4, the wider then the higher
 *  priority first, each grid's own range unscaled, a radius of 100 m otherwise, no sector, a whole
 *  turn, no cell kept out by its height, a blocking grid blocking, under a ratio of 0.25, the
 *  HLOD actors on, the cells wished again only once the view moved 4 m or turned 10° (an update
 *  optimisation on, never forced to run; a quantization of 0 compares the exact value), no shape
 *  forced to the ground, no extra radius (metres) nor angle (degrees), the cells wished to
 *  activate, not only to load, the view's priority 128 (normal; 0 the highest, 255 the lowest),
 *  its velocity not added to the axis the cells are sorted along. */
const WORLD_STREAMING_SETTINGS = /* @__PURE__ */ (() =>
  ({
    maxLoadingCells: integer('worldStreamingMaxLoadingCells', 4, LOADING_CELLS),
    angleWeight: number('worldStreamingAngleWeight', 0.4, [0, 1]),
    sortByExtent: flag('worldStreamingSortByExtent', true),
    sortByPriority: flag('worldStreamingSortByPriority', true),
    useGridRange: flag('worldStreamingUseGridRange', true),
    rangeScale: nonNegative('worldStreamingRangeScale', 1),
    radius: nonNegative('worldStreamingRadius', 100),
    sector: flag('worldStreamingSector', false),
    sectorAngle: number('worldStreamingSectorAngle', 360, [0, 360]),
    zCulling: flag('worldStreamingZCulling', false),
    blockOnSlowStreaming: flag('worldStreamingBlockOnSlowStreaming', true),
    blockOnSlowStreamingRatio: nonNegative('worldStreamingBlockOnSlowStreamingRatio', 0.25),
    hlod: flag('hlodEnabled', true),
    updateOptimization: flag('worldStreamingUpdateOptimization', true),
    locationQuantization: nonNegative('worldStreamingLocationQuantization', 4),
    rotationQuantization: nonNegative('worldStreamingRotationQuantization', 10),
    forceUpdateFrames: count('worldStreamingForceUpdateFrameCount', 0, 0),
    force2D: flag('worldStreamingForce2D', false),
    extraRadius: nonNegative('worldStreamingExtraRadius', 0),
    extraAngle: nonNegative('worldStreamingExtraAngle', 0),
    targetState: choice('worldStreamingTargetState', 'activated', ['activated', 'loaded']),
    priority: integer('worldStreamingPriority', 128, [0, 255]),
    useVelocity: flag('worldStreamingUseVelocity', false),
  }) as const)()
/** How the view streams a partitioned scene's cells, every setting named. */
export type WorldStreaming = SettingValues<typeof WORLD_STREAMING_SETTINGS>
/** The view's streaming settings as a host writes them, by their fields. */
export type WorldStreamingOptions = SettingOptions<RulesByField<typeof WORLD_STREAMING_SETTINGS>>

/** The HLOD warm-up's settings, by the name the frame reads them by, each with the reference's
 *  default: on, 5 frames, the geometry asked, the textures asked at twice the size covered, 2048
 *  texels at most. */
const HLOD_WARMUP_SETTINGS = /* @__PURE__ */ (() =>
  ({
    enabled: flag('hlodWarmup', true),
    frames: count('hlodWarmupFrames', 5, 0),
    geometry: flag('hlodWarmupGeometry', true),
    textures: flag('hlodWarmupTextures', true),
    textureScale: nonNegative('hlodWarmupTextureScale', 2),
    textureClamp: count('hlodWarmupTextureClamp', 2048, 1),
  }) as const)()
/** The warm-up an HLOD switch waits on, every setting named. */
export type HlodWarmup = SettingValues<typeof HLOD_WARMUP_SETTINGS>
/** The HLOD warm-up's settings as a host writes them, by their fields. */
export type HlodWarmupOptions = SettingOptions<RulesByField<typeof HLOD_WARMUP_SETTINGS>>

/** Each setting's rule by its field (`resolveSetting`): the view's streaming, then the HLOD
 *  warm-up. */
export const WORLD_STREAMING_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    ...Object.values(WORLD_STREAMING_SETTINGS),
    ...Object.values(HLOD_WARMUP_SETTINGS),
  ] as const))()
/** The fields of every setting of this file: the view's streaming, then the HLOD warm-up. */
export type WorldStreamingField = keyof typeof WORLD_STREAMING_RULES

/**
 * The view's streaming `options` name (`WORLD_STREAMING_SETTINGS`), every setting its default
 * when left out, written in `into` when given: a frame's reading reuses one object.
 * @throws TypeError naming the field and the values it takes when one is out of them.
 */
export const resolveWorldStreaming = (
  options: WorldStreamingOptions = {},
  into = {} as WorldStreaming,
): WorldStreaming => resolveSettingsInto(WORLD_STREAMING_SETTINGS, options, into)

/**
 * The HLOD warm-up `options` name (`HLOD_WARMUP_SETTINGS`), every setting its default when left
 * out, written in `into` when given.
 * @throws TypeError naming the field and the values it takes when one is out of them.
 */
export const resolveHlodWarmup = (
  options: HlodWarmupOptions = {},
  into = {} as HlodWarmup,
): HlodWarmup => resolveSettingsInto(HLOD_WARMUP_SETTINGS, options, into)
