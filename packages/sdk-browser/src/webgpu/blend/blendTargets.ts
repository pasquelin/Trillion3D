import { FEEDBACK_FORMAT } from '../../scene/surfaceBuffer.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import { COVERAGE_EQUATIONS, filtersDisplay } from './equations.ts'
import { displayTargets } from './displayFilter.ts'
import { SHARE_TARGET } from '../../lighting/deferred/asIsShare.ts'
import { FRONT_TARGET } from '../../reflections/frontDepth.ts'

/** The pass's targets in `mode`; `filtered`, with the display layers (`displayFilter.ts`); `share`,
 *  with the share a debug view or the temporal pass reads (`asIsShare.ts`), else an empty slot; last
 *  always, the front depth the reflections march (`frontDepth.ts`). */
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
  // The display layers' slots stay empty in an unfiltered pass, so that the front depth's lies at
  // the same place whatever the pass (`BlendOut`).
  ...(filtered ? displayTargets(mode) : [null, null]),
  FRONT_TARGET,
]
