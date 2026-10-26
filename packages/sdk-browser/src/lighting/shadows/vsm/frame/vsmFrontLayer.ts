import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { cameraSeen, previousCameraOf } from '../../../../frame/backend/state/previousCamera.ts'
import { frontStamp } from '../../../reflections/frontLayer.ts'
import { matrixAtRenderOrigin } from '../../../../../../math/src/projection/renderOrigin.ts'
import type { VsmMarkingFront } from '../markingPass.ts'

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
  previousViewProjection: new Float64Array(16),
  size: [0, 0],
})

/**
 * THE TRANSLUCENT FRONT LAYER THE PAGE MARKING READS, where the project traces the translucent
 * surfaces' shadow (`shadowTranslucentQuality` above 0): the layer the transparents' front pass of
 * the image before drew into the depth pyramid's level 0 (`encodeFrontPass`, drawn after the marking
 * of its own image, so the marking meets it as history), with that image's camera and the size it drew
 * at (`held`). None — the marking without it — where that image drew no front pass or none of its
 * own (`front.drawn` is not the image the marking last ran for), where it is not the image drawn
 * just before this one (`cameraSeen`), where the setting is 0, or where no depth pyramid is in
 * place. Notes this image in `seen`, whatever it finds, for the next.
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
  if (!rt.setup.translucentShadow.quality || image === 0) return undefined
  const depth = vis.gpuHiz?.depth()?.resources[0]
  const before = cameraSeen(previousCameraOf(rt), image)
  if (!depth || !before || gpu.reflection?.front.drawn !== frontStamp(image)) return undefined
  held.depth = depth
  // The camera of that image, referred to this image's eye: the shifted positions the pass holds.
  matrixAtRenderOrigin(held.previousViewProjection, before.viewProjection, cam.eye)
  held.size[0] = width
  held.size[1] = height
  return held
}
