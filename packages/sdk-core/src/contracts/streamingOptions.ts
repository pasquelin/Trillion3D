import {
  countSetting as count,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * The run-time settings of the geometry streaming
 * (`packages/sdk-browser/src/geometry/residency/queue.ts`), by STREAMING PAGE — the 128 KiB page the
 * compiler packs a mesh's clusters in, read, installed and given up whole —: how many it keeps
 * started at once, how many a frame installs, and how the streaming pool's load scales the cut's
 * screen error
 * (`packages/sdk-browser/src/geometry/residency/poolPressure.ts`). They are the engine's own, read
 * again at each update of the streaming: no compiler job names them, so no manifest carries them
 * and no cache key holds them. None has quality levels: the scalability groups of the reference
 * leave all five at their defaults, so a quality preset writes none (`../runtime/qualityLevels.ts`).
 * Each is a world option (`WorldOptions`), a session option (`MeasuredWorldOptions`), a render
 * setting of the view distance's group (`packages/sdk-browser/src/session/world/settings.ts`), and
 * the LLM schemas name it by its field and say what it means (`../llm/settingProperties.ts`). Each
 * is read by the one resolver of the rules (`resolveSetting`, `./settingRules.ts`) wherever it is
 * taken — the world, a session at its opening, the session's setter, the streaming's update —: a
 * value within its range as itself, `undefined` or `null` its default, anything else refused with
 * a `TypeError` naming the field and the values it takes.
 */

/** The pending pages' default, 128: the reference's own. */
export const DEFAULT_STREAMING_MAX_PENDING_PAGES = 128
/** The installs' default, 128: the reference's own. */
export const DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME = 128
/** The low mark's default, 70 %: the reference's own. */
export const DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT = 70
/** The high mark's default, 85 %: the reference's own. */
export const DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT = 85
/** The lowest scale's default, 0.3: the reference's own. */
export const DEFAULT_STREAMING_QUALITY_MIN_SCALE = 0.3

/** The streaming's settings by field, in the order the streaming reads them: the 128 KiB streaming
 *  pages kept started at once — each update starts the new ones the views ask for while fewer are
 *  pending —, those a frame installs at most — never more than may be pending —, the pool's load
 *  in percent of its slots under which the quality rises again and over which it falls — read no
 *  lower than the low mark —, and the lowest scale of the screen error the pool's load falls to. */
export const STREAMING_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    count('streamingMaxPendingPages', DEFAULT_STREAMING_MAX_PENDING_PAGES, 1),
    count('streamingMaxInstallsPerFrame', DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME, 1),
    number('streamingQualityMinPoolPercent', DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT, [10, 100]),
    number('streamingQualityMaxPoolPercent', DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT, [10, 100]),
    number('streamingQualityMinScale', DEFAULT_STREAMING_QUALITY_MIN_SCALE, [0.1, 1]),
  ] as const))()
/** The field of one streaming setting. */
export type StreamingField = keyof typeof STREAMING_RULES
/** The streaming settings as a host writes them: each its value, or nothing for its default. */
export type StreamingOptions = SettingOptions<typeof STREAMING_RULES>
