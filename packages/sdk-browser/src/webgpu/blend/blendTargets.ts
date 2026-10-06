import { FEEDBACK_FORMAT } from '../../scene/surfaceBuffer.ts'
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
    format: 'rgba16float',
    writeMask: filtered && filtersDisplay(mode) ? 0 : mask,
    blend: COVERAGE_EQUATIONS[mode],
  },
  ...(feedback ? [{ format: FEEDBACK_FORMAT }] : []),
  share ? SHARE_TARGET : null, // every mode covers it at its alpha, green included
  ...(filtered ? displayTargets(mode) : []),
]
