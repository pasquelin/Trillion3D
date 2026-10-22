import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import type { CloudSetup } from './cloudModes.ts'
import { put4 } from './reconstructLayout.ts'
import type { CLOUD_TRACE_LAYOUT, CloudTraceImage } from './traceLayout.ts'

/** The slices of the empty-space table along the depth (the threads of its group along z) and its
 *  side in texels. */
export const CLOUD_EMPTY_SPACE_SLICES = 64
export const CLOUD_EMPTY_SPACE_SIDE = 32

/** The words of the trace block's fields. */
type CloudTraceLayoutAt = (typeof CLOUD_TRACE_LAYOUT)['at']

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** Centimetres in a kilometre. */
const CM_PER_KM = 100000

/** Whether the haze on the clouds is traced per pixel in a second pass, not by the trace: asked for,
 *  with the haze on the clouds and an air to scatter it (never in a capture, which marks its own
 *  block: `markCloudTraceCapture`). */
export const cloudHazeInSecondPass = (
  quality: Pick<SkyQualityValues, 'cloudHighQualityAerial' | 'cloudAerialPerspective'>,
  airPresent: boolean,
) => quality.cloudHighQualityAerial && quality.cloudAerialPerspective && airPresent

/** The block's fields the reference's options set (`CLOUD_TRACE_LAYOUT`): the haze, the sun's
 *  shadow channel, the light grid, the empty-space table, the ground and the lamps' shadow rays. */
export function writeCloudTraceOptions(
  out: Float32Array,
  words: Uint32Array,
  at: CloudTraceLayoutAt,
  image: CloudTraceImage,
  { settings, quality }: CloudPart,
  setup: CloudSetup,
) {
  const hazeInSecondPass = cloudHazeInSecondPass(quality, image.airPresent)
  out.set(image.viewProjection ?? IDENTITY, at.viewProjection)
  put4(
    words,
    at.options,
    quality.cloudAerialPerspective && !hazeInSecondPass ? 1 : 0,
    0,
    setup.mode.cutsAtScene ? 1 : 0,
    image.sunShadowChannel ?? NO_INDEX,
  )
  const cells = image.lightGridCells ?? [0, 0]
  put4(words, at.view, image.view.width, image.view.height, cells[0], cells[1])
  const volumeCm = CM_PER_KM * quality.cloudEmptySpaceSkippingDepthKm
  put4(
    out,
    at.empty,
    volumeCm / CLOUD_EMPTY_SPACE_SLICES,
    volumeCm,
    quality.cloudEmptySpaceSkippingSliceBias,
    0,
  )
  put4(
    out,
    at.ground,
    settings.groundAlbedo[0],
    settings.groundAlbedo[1],
    settings.groundAlbedo[2],
    0,
  )
  put4(out, at.local, quality.cloudLocalLightShadowSamples, 0, 0, 0)
}
