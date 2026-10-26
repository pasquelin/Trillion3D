import { beautyImage, wantsContractLighting } from '../../frame/prepare/lit.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** Whether the image is finished at all: lit by declared lamps and the beauty one. A view that
 *  shows the albedo, a diagnostic view and a capture show the image as it is. */
export const wanted = (rt: WebgpuPagesRuntime) => wantsContractLighting(rt) && beautyImage(rt)
