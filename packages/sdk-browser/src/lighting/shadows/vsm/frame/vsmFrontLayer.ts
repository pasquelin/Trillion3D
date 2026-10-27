import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { cameraSeen, previousCameraOf } from '../../../../frame/backend/state/previousCamera.ts'
import { frontStamp } from '../../../reflections/frontLayer.ts'
import { vsmMapSettings } from './vsmFarShadow.ts'
import { marksSunPages, tracesTranslucent } from './vsmGates.ts'
import { matrixAtRenderOrigin } from '../../../../../../math/src/projection/renderOrigin.ts'
import { marksFromPixels, type VsmMarkingFront } from '../markingPass.ts'
import { waterDepthPrepassWanted } from '../../../../blend/water/waterTargets.ts'

/** The image the marking last ran for: its number (`WebgpuRun.frame`) and the size it drew at. */
export interface VsmFrontSeen {
  image: number
  width: number
  height: number
}

/** A marking that has run for no image. */
export const newFrontSeen = (): VsmFrontSeen => ({ image: 0, width: 0, height: 0 })

/** The new front layer, its matrix and size made once. */
export const newMarkingFront = (): VsmMarkingFront => ({
  depth: undefined as never,
  sameImage: false,
  previousViewProjection: new Float64Array(16),
  size: [0, 0],
})

/** The camera of the image `image`, the marking's last, where that image is the one drawn just
 *  before this one and drew a front pass of its own (`front.drawn` is its stamp); none otherwise. */
function historyCamera(rt: WebgpuPagesRuntime, image: number) {
  const before = cameraSeen(previousCameraOf(rt), image)
  return before && rt.gpu.reflection?.front.drawn === frontStamp(image) ? before : undefined
}

/** Whether the marking of this image marks from the pixels (`marksFromPixels`): the one rule the
 *  pipelines made, the froxels' and the water's depth follow. */
export const marksPixels = (rt: WebgpuPagesRuntime) => marksFromPixels(vsmMapSettings(rt).shadows)

/**
 * Whether the scene's single-layer water is to have its depth drawn before a marking that marks from
 * the pixels, which then marks the suns' pages at the water's surface: the water is drawn
 * (`singleLayerWater`) with its depth pass (`singleLayerWaterDepthPrepass`). What the marking's
 * pipelines are made for, whether or not this image marks a sun's pages.
 */
export const marksWaterSurface = (rt: WebgpuPagesRuntime) =>
  marksPixels(rt) && waterDepthPrepassWanted(rt)

/** Whether the water's depth is to be drawn before this image's marking: a sun's pages are marked
 *  (`marksSunPages`) at the water's surface (`marksWaterSurface`). */
export const drawsWaterBeforeMarking = (rt: WebgpuPagesRuntime) =>
  marksSunPages(rt) && marksWaterSurface(rt)

/**
 * Whether the transparents' front pass is to be drawn before this image's marking: a sun's pages are
 * marked (`marksSunPages`) from the pixels, the translucent surfaces' shadow is traced
 * (`shadowTranslucentQuality` above 0) and the image before left the marking no front layer to read
 * (`markingFrontLayer`) — a first image, a camera cut, an image before that drew none —, so the
 * marking reads the layer of its own image.
 */
export const drawsFrontBeforeMarking = (rt: WebgpuPagesRuntime) =>
  marksSunPages(rt) &&
  marksPixels(rt) &&
  tracesTranslucent(rt) &&
  !historyCamera(rt, rt.lights.vsm?.frameScratch?.frontSeen.image ?? 0)

/**
 * THE TRANSLUCENT FRONT LAYER THE PAGE MARKING READS, where the project traces the translucent
 * surfaces' shadow (`shadowTranslucentQuality` above 0): the layer of the transparents' front pass
 * (`encodeFrontPass`) in the depth pyramid's level 0 —
 * - this image's own where the front pass was drawn before the marking (`drawsFrontBeforeMarking`),
 *   read at the pixel (`held.sameImage`);
 * - else the layer the image before drew, after the marking of its own image, with that image's
 *   camera and the size it drew at: none where that image drew no front pass or none of its own
 *   (`front.drawn` is not the image the marking last ran for) or is not the image drawn just before
 *   this one (`cameraSeen`).
 * None — the marking without it — where the setting is 0 or where no depth pyramid is in place.
 * Notes this image in `seen`, whatever it finds, for the next.
 */
export function markingFrontLayer(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  seen: VsmFrontSeen,
  held: VsmMarkingFront,
) {
  const { gpu, vis, run } = rt
  const { image, width, height } = seen
  const [drawnWidth, drawnHeight] = gpu.targetSize
  seen.image = run.frame
  seen.width = drawnWidth
  seen.height = drawnHeight
  const depth = vis.gpuHiz?.depth()?.resources[0]
  if (!tracesTranslucent(rt) || !depth) return undefined
  held.sameImage = gpu.reflection?.front.drawn === frontStamp(run.frame)
  if (!held.sameImage) {
    const before = historyCamera(rt, image)
    if (!before) return undefined
    // The camera of that image, referred to this image's eye: the shifted positions the pass holds.
    matrixAtRenderOrigin(held.previousViewProjection, before.viewProjection, cam.eye)
    held.size[0] = width
    held.size[1] = height
  }
  held.depth = depth
  return held
}
