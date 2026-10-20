import { FEEDBACK_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { COVERAGE_EQUATIONS, filtersDisplay } from './equations.ts'
import { displayTargets } from './displayFilter.ts'
import { SHARE_TARGET } from '../../lighting/deferred/asIsShare.ts'

/** The pass's targets in `mode`; `filtered`, with the display layers (`displayFilter.ts`); `share`,
 *  with the share a debug view or the temporal pass reads (`asIsShare.ts`), else an empty slot. */
export const blendTargets = (
  mode: Blending,
  mask: GPUColorWriteFlags,
  feedback: boolean,
  filtered = false,
  share = true,
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
]

/** The companion pass's targets (`drawCompanion`): what its first attachment takes — none, or the
 *  distortion's offsets —, the request where the pipeline writes feedback, and `shareTarget` — the
 *  as-is share, or its reactive green alone — where the frame has a share; an empty slot for each
 *  it leaves out. */
export const companionTargets = (
  first: GPUColorTargetState | null,
  feedback: boolean,
  share: boolean,
  shareTarget: GPUColorTargetState = SHARE_TARGET,
): (GPUColorTargetState | null)[] => [
  first,
  feedback ? { format: FEEDBACK_FORMAT } : null,
  share ? shareTarget : null,
]
