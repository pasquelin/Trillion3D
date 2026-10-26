import { FEEDBACK_FORMAT, HDR_FORMAT } from '../scene/targetFormats.ts'
import type { Blending } from '../../../sdk-core/src/world/constants/index.ts'
import { filtersDisplay } from './equations.ts'
import {
  BLEND_EQUATIONS,
  COLOUR_ONLY,
  OVER,
  modulatesScene,
} from '../materials/surface/materialBlending.ts'
import { displayTargets } from './display/displayFilter.ts'

/** The colour channels alone: a layer that multiplies the scene leaves the modulation target's
 *  alpha, the coverage of the transmissive layers (`DUAL_MODULATE`), as it is. */
/** What a layer of `mode` writes to its target — the translucency target's red, green, blue and
 *  alpha, or the modulation target's colour alone — and by which equation. */
const layerTarget = (mode: Blending, mask: GPUColorWriteFlags): GPUColorTargetState => ({
  format: HDR_FORMAT,
  writeMask: modulatesScene(mode) ? mask & COLOUR_ONLY : mask,
  blend: BLEND_EQUATIONS[mode],
})

/** The pass's targets in `mode`; `filtered`, with the display layers (`display/displayFilter.ts`). */
export const blendTargets = (
  mode: Blending,
  mask: GPUColorWriteFlags,
  feedback: boolean,
  filtered = false,
): (GPUColorTargetState | null)[] => [
  // The translucency target, or for a mode that multiplies the scene the modulation target
  // (`modulatesScene`); a filtering mode of a filtered image leaves it to the display layers.
  filtered && filtersDisplay(mode)
    ? { ...layerTarget(mode, mask), writeMask: 0 }
    : layerTarget(mode, mask),
  // The request's location: its target, or an empty slot where the pipeline writes no feedback.
  feedback ? { format: FEEDBACK_FORMAT } : null,
  ...(filtered ? displayTargets(mode) : [null, null]),
]

/** The targets of the request stage in the modulation pass of the dual blend (`drawModulation`): the
 *  modulation target, its write mask empty — the layer multiplies nothing there — and the request. */
export const marksTargets = (): GPUColorTargetState[] => [
  { format: HDR_FORMAT, writeMask: 0 },
  { format: FEEDBACK_FORMAT },
]

/** The fallback without dual-source blending: premultiplied colour over, its grey coverage letting
 *  less of what is behind through. */
const OVER_BLEND: GPUBlendState = { color: OVER, alpha: BLEND_EQUATIONS.normal.alpha }

/** The translucency target alone, a layer blended over: the colour pass of the dual blend takes a
 *  layer that transmits all channels alike on it. */
export const layerOnlyTargets = (): GPUColorTargetState[] => [
  { format: HDR_FORMAT, blend: OVER_BLEND },
]

/** The targets of the fallback, as the blend pass lays them (`blendTargets`): the translucency
 *  target, the request, the display layers of a normal layer where it is `filtered`. */
export const overTargets = (
  feedback: boolean,
  filtered: boolean,
): (GPUColorTargetState | null)[] => [
  ...layerOnlyTargets(),
  feedback ? { format: FEEDBACK_FORMAT } : null,
  ...(filtered ? displayTargets('normal') : [null, null]),
]
