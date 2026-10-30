import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { screenProbeSettingsOf } from '../../../bounce/screen/settingsOf.ts'
import { VISUALIZE_HISTORY_MODES } from '../../visualizeModes.ts'
import { probeDebugOf } from '../probeTables.ts'

/**
 * Whether this image's scene view traces its rays through the scene's triangles (`visualizeHardwareRayTracing`): the main view shows the scene view, in a mode that draws the scene. The lighting
 * then keeps the scene trace for the image (`sceneRaysOf`, `LightingInputs.probes`) as it does for the probes' rays.
 */
export function sceneVisualizeTraced(rt: WebgpuPagesRuntime) {
  if (rt.views.active !== rt.views.main) return false
  const view = probeDebugOf(screenProbeSettingsOf(rt).values, rt.run.diagnostic)
  return (
    view.sceneVisualization &&
    view.sceneHardware &&
    !VISUALIZE_HISTORY_MODES.includes(view.sceneMode)
  )
}
