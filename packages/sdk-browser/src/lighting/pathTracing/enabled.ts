import { readPathTracingSetting } from '../../../../sdk-core/src/contracts/pathTracingOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** Whether the view is drawn by the path tracer (`pathTracing`): the lighting then makes the scene trace its rays go through for the image, and the lit image is the tracer's. */
export const pathTracingOn = (rt: Pick<WebgpuPagesRuntime, 'context'>) =>
  readPathTracingSetting(rt, 'pathTracing')
