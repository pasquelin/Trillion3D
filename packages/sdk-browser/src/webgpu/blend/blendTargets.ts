import { FEEDBACK_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { COVERAGE_EQUATIONS, filtersDisplay } from './equations.ts'
import { displayTargets } from './displayFilter.ts'
import { GIVEN_UP_TARGET, SHARE_TARGET } from '../../lighting/deferred/asIsShare.ts'

/** The share targets a transparent pipeline writes, a part of its key: none (0), the share a debug
 *  view or the temporal pass reads (1), or the share and the history given up beside it (2), which
 *  a frame binds only where its blends give some up to a temporal pass (`blendShareTargets`). */
export type ShareTargets = 0 | 1 | 2
/** Every share-target key, in key order: the pipeline sets are made by it. */
export const SHARE_TARGET_KEYS: readonly ShareTargets[] = [0, 1, 2]

/** The pass's targets in `mode`; `filtered`, with the display layers (`displayFilter.ts`); `share`
 *  (`ShareTargets`), with the share and, at 2, the history given up beside it, last
 *  (`asIsShare.ts`), else empty slots. */
export const blendTargets = (
  mode: Blending,
  mask: GPUColorWriteFlags,
  feedback: boolean,
  filtered = false,
  share: ShareTargets = 2,
): (GPUColorTargetState | null)[] => [
  // A filtering mode of a filtered image leaves the lit target to the display layers.
  {
    format: HDR_FORMAT,
    writeMask: filtered && filtersDisplay(mode) ? 0 : mask,
    blend: COVERAGE_EQUATIONS[mode],
  },
  // The request's location: its target, or an empty slot where the pipeline writes no feedback.
  feedback ? { format: FEEDBACK_FORMAT } : null,
  share ? SHARE_TARGET : null, // every mode covers it at its alpha, green included
  ...(filtered ? displayTargets(mode) : [null, null]),
  share === 2 ? GIVEN_UP_TARGET : null,
]

/** The companion pass's targets (`drawCompanion`): what its first attachment takes — none, or the
 *  distortion's offsets —, the request where the pipeline writes feedback, and `shareTarget` — the
 *  as-is share, or its reactive green alone — where the frame has a share, then the history given
 *  up at `share` 2 (`ShareTargets`); an empty slot for each it leaves out. */
export const companionTargets = (
  first: GPUColorTargetState | null,
  feedback: boolean,
  share: ShareTargets,
  shareTarget: GPUColorTargetState = SHARE_TARGET,
): (GPUColorTargetState | null)[] => [
  first,
  feedback ? { format: FEEDBACK_FORMAT } : null,
  share ? shareTarget : null,
  share === 2 ? GIVEN_UP_TARGET : null,
]
