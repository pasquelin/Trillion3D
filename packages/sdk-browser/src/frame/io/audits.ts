import { readPartitionAudit } from '../../gpu/core/partitionAudit.ts'
import { readTransparentOcclusionAudit } from '../../blend/transparent/occlusionAudit.ts'
import type { Engine } from '../../session/engine/types.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

type Audits = Required<Pick<Engine, 'partitionAudit' | 'transparentOcclusionAudit'>>

/** The device readbacks that prove a pass drew right: the partition's rectangles and the
 *  transparent occlusion test's rejections, never an image. */
export const webgpuAudits = (rt: WebgpuPagesRuntime): Audits => ({
  partitionAudit() {
    return readPartitionAudit(rt)
  },
  transparentOcclusionAudit() {
    return readTransparentOcclusionAudit(rt)
  },
})
