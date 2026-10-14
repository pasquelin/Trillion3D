import { readPartitionAudit } from '../../core/partitionAudit.ts'
import { readTransparentOcclusionAudit } from '../../transparent/occlusionAudit.ts'
import type { Engine } from '../../../engine/types.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

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
