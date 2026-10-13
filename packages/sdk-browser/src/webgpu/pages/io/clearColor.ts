import { recolourBlendScene } from '../../../cluster/blendSceneRecord.ts'
import { RASTER_BACKGROUND } from '../../../page/raster.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** A new clear colour, `0xrrggbb`, or none declared (`undefined`: the default drawn, and a ray that
 *  leaves the scene reaches the environment): every pass reads it at the next frame, the blend
 *  scene publishes it, and the held frame is broken — the resource revision alone, nothing walked. */
export function setWebgpuClearColor(rt: WebgpuPagesRuntime, declared: number | undefined) {
  const clearColor = declared ?? RASTER_BACKGROUND
  rt.run.clearColor = clearColor
  rt.run.backgroundDeclared = declared !== undefined
  recolourBlendScene(rt.setup.scene, clearColor)
  rt.run.gate.resourcesChanged()
}
