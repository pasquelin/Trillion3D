import { readTransparentOcclusionAudit } from '../../blend/transparent/occlusionAudit.ts'
import type { Engine } from '../../session/engine/types.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

type Audits = Required<Pick<Engine, 'transparentOcclusionAudit'>>

/** The device readback that proves a pass drew right: the transparent occlusion test's
 *  rejections, never an image. */
export const webgpuAudits = (rt: WebgpuPagesRuntime): Audits => ({
  transparentOcclusionAudit() {
    return readTransparentOcclusionAudit(rt)
  },
})
