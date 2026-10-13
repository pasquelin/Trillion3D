import { forgetReflectedImage } from './gpu.ts'
import { mainViewGpu, viewGpu } from '../webgpu/pages/state/view.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** The reflected image of every view restarts (`forgetReflectedImage`): the content the lit image
 *  held is not the content the scene draws now — it joined, or the tables it waited for have grown. */
export function forgetReflectedImages(rt: WebgpuPagesRuntime) {
  forgetReflectedImage(mainViewGpu(rt).reflection)
  for (const view of rt.views.persistent) forgetReflectedImage(viewGpu(rt, view).reflection)
}
