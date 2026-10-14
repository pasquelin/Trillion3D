import { readPartitionAudit } from '../../core/partitionAudit.ts'
import { readTransparentOcclusionAudit } from '../../transparent/occlusionAudit.ts'
import type { Engine } from '../../../engine/types.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { readRayAudit } from '../../rays/rayAudit.ts'

type Audits = Required<Pick<Engine, 'partitionAudit' | 'transparentOcclusionAudit' | 'rayAudit'>>

/** The device readbacks that prove a pass drew right: the partition's rectangles, the
 *  transparent occlusion test's rejections and the ray query's work, never an image. */
export const webgpuAudits = (rt: WebgpuPagesRuntime): Audits => ({
  partitionAudit() {
    return readPartitionAudit(rt)
  },
  transparentOcclusionAudit() {
    return readTransparentOcclusionAudit(rt)
  },
  rayAudit(rays) {
    return readRayAudit(rt, rays)
  },
})
