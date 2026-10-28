import { environmentExposure } from '../../../../sdk-core/src/scene/core/environment.ts'
import { DEPTH_OF_FIELD_VOLUME_RULES } from '../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'
import {
  fixedExposure,
  manualExposure,
  newHeldExposure,
  type HeldExposure,
} from '../../../../sdk-core/src/contracts/exposureManual.ts'
import type { DepthOfField } from '../../../../sdk-core/src/world/effect/depthOfField.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { contrastTablesOf, exposureCurveOf, exposureMeasured, exposureSettings } from './frame.ts'

/** What the CPU reads of the runtime for the exposure: the scene's lights and their environment,
 *  the settings, the effect chain. */
type ExposureReads = Pick<WebgpuPagesRuntime, 'lights' | 'context'>

/** The lens' f-stop: the depth of field's aperture where the view's chain holds one, drawing or
 *  not, else the aperture it would start with. */
function lensApertureOf(rt: ExposureReads) {
  for (const pass of rt.context.effects?.passes ?? [])
    if (pass.kind === 'depthOfField') return (pass as DepthOfField).values.aperture
  return DEPTH_OF_FIELD_VOLUME_RULES.aperture.default
}

/** The exposure the view holds, rewritten at each call: a frame allocates none. */
const held = newHeldExposure()

/**
 * THE EXPOSURE THE ENGINE HOLDS WITHOUT MEASURING IT: a number the scene names (a fixed exposure,
 * the number itself), or the manual method's (`manualExposure`: the camera and the bias); none where
 * the meter measures the view's image. Read once an image, by `beginPreExposure`, which keeps it
 * for the image (`PreExposure.held`): the meter writes it into its exposure buffer, from which the
 * composition and the finishing take the scale and the middle grey (`ExposureMeter.hold`).
 */
export function heldExposureOf(rt: ExposureReads): HeldExposure | undefined {
  if (exposureMeasured(rt)) return undefined
  const exposure = environmentExposure(rt.lights.store?.environment)
  const settings = exposureSettings(rt)
  return exposure === 'auto'
    ? manualExposure(settings, exposureCurveOf(rt), lensApertureOf(rt), held, contrastTablesOf(rt))
    : fixedExposure(exposure, settings, held)
}
