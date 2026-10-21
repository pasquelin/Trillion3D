import {
  countSetting as count,
  flagSetting as flag,
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
 * `packages/sdk-browser/src/geometry/partition/source.ts`, `slowStreaming.ts` beside it), and the
 * warm-up a switch that draws an HLOD actor waits on (`HLOD_WARMUP_SETTINGS`,
 * `packages/sdk-browser/src/frame/prepare/hlodWarm.ts`). They are the engine's own, read again at
 * each frame: no compiler job names them, so no manifest carries them and no cache key holds them.
 * None has quality levels: the scalability groups of the reference leave every one at its
 * default, so a quality preset writes none (`../runtime/qualityLevels.ts`). Each is a world option
 * (`WorldOptions`), a session option (`MeasuredWorldOptions`), a render setting of the view
 * distance's group (`packages/sdk-browser/src/session/world/settings.ts`), and the LLM schemas
 * name it by its field and say what it means (`../llm/settingProperties.ts`). Each is read by the
 * one resolver of the rules (`resolveSetting`, `./settingRules.ts`) wherever it is taken — the
 * world, a session at its opening, the session's setter —: a value it takes as itself,
 * `undefined` or `null` its default, anything else refused with a `TypeError` naming the field
 * and the values it takes.
 */

/** How many cells may load at once: a whole number a 32-bit counter holds; 0 or less lifts the
 *  limit, every cell wished starting at once. */
const LOADING_CELLS: readonly [number, number] = [-2147483648, 2147483647]

/** The view's streaming settings, by the name the partition reads them by, each with the
 *  reference's default: 4 cells loading at once, an angle weight of 0.4, the wider then the higher
 *  priority first, each grid's own range unscaled, a radius of 100 m otherwise, no sector, a whole
 *  turn, no cell kept out by its height, a blocking grid blocking, under a ratio of 0.25, the
 *  HLOD actors on. */
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
