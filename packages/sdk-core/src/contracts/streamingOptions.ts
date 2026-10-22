import {
  ANY_NUMBER as ANY,
  countSetting as count,
  INT32_RANGE,
  integerSetting as integer,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
  type SettingRange,
} from './settingRules.ts'

/**
 * The run-time settings of the geometry streaming
 * (`packages/sdk-browser/src/geometry/residency/queue.ts`), by STREAMING PAGE — the 128 KiB page the
 * compiler packs a mesh's clusters in, read, installed and given up whole —: how many it keeps
 * started at once, how many a frame installs, how the streaming pool's load scales the cut's
 * screen error (`packages/sdk-browser/src/geometry/residency/poolPressure.ts`), how many times a
 * failed read is tried again before its object is given up, how many requests the readout of
 * the camera's cut holds, and the bandwidth the reads are simulated to have. Run-time settings, as
 * `./settingRules.ts` says, read again at each update of the streaming.
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
/** The tries again of a failed read, 3 by default: the reference's own. */
export const DEFAULT_STREAMING_NUM_RETRIES = 3
/** The least requests the readout holds, 65 536 by default: the reference's own. */
export const DEFAULT_STREAMING_MIN_REQUESTS = 65_536
/** The most requests the readout holds, 1 048 576 by default: the reference's own. */
export const DEFAULT_STREAMING_MAX_REQUESTS = 1_048_576
/** The simulated bandwidth's default, −1: none — a negative limit is no limit; the reference's own. */
export const DEFAULT_STREAMING_BANDWIDTH_LIMIT = -1

/** How many times a failed read is tried again: a whole number a 32-bit counter holds; negative
 *  tries without end. */
const NUM_RETRIES: SettingRange = INT32_RANGE
/** The requests the readout holds, from 4 096 to 1 048 576: the reference's own limits. */
const REQUESTS_RANGE: SettingRange = [4096, 1_048_576]

/** The streaming's settings by field, in the order the streaming reads them: the 128 KiB streaming
 *  pages kept started at once — each update starts the new ones the views ask for while fewer are
 *  pending —, those a frame installs at most — never more than may be pending —, the pool's load
 *  in percent of its slots under which the quality rises again and over which it falls — read no
 *  lower than the low mark —, the lowest scale of the screen error the pool's load falls to, the
 *  tries again of a failed read — after the last, its object is given up, no page of it asked for
 *  again; negative, never —, and the least and the most requests the camera cut's readout holds —
 *  a request is a leaf the cut keeps: it starts at the least, grows to a quarter over what the cut
 *  asks of it and gives a fiftieth back each readback after thirty under half
 *  (`packages/sdk-browser/src/geometry/dag/lists/requestSize.ts`), read no higher than the most —,
 *  and the bandwidth limit, in megabytes a second — a streaming page whose bytes are in takes them,
 *  before its install, at that rate: each frame gives it what the time since the frame before
 *  allows, and the pages behind it wait —, negative for none. */
export const STREAMING_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    count('streamingMaxPendingPages', DEFAULT_STREAMING_MAX_PENDING_PAGES, 1),
    count('streamingMaxInstallsPerFrame', DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME, 1),
    number('streamingQualityMinPoolPercent', DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT, [10, 100]),
    number('streamingQualityMaxPoolPercent', DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT, [10, 100]),
    number('streamingQualityMinScale', DEFAULT_STREAMING_QUALITY_MIN_SCALE, [0.1, 1]),
    integer('streamingNumRetries', DEFAULT_STREAMING_NUM_RETRIES, NUM_RETRIES),
    integer('streamingMinRequests', DEFAULT_STREAMING_MIN_REQUESTS, REQUESTS_RANGE),
    integer('streamingMaxRequests', DEFAULT_STREAMING_MAX_REQUESTS, REQUESTS_RANGE),
    number('streamingBandwidthLimit', DEFAULT_STREAMING_BANDWIDTH_LIMIT, ANY),
  ] as const))()
/** The field of one streaming setting. */
export type StreamingField = keyof typeof STREAMING_RULES
/** The streaming settings as a host writes them: each its value, or nothing for its default. */
export type StreamingOptions = SettingOptions<typeof STREAMING_RULES>
