import { readShadowAtlasDigest } from '../../../gpu/shadow/digest.ts';
import { readPartitionAudit } from '../../core/partitionAudit.ts';
import { readTransparentOcclusionAudit } from '../../transparent/occlusionAudit.ts';
import type { RenderBackend } from '../../../backend/types.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

type Audits = Required<
  Pick<RenderBackend, 'partitionAudit' | 'transparentOcclusionAudit' | 'shadowAtlasDigest'>
>;

/** The device readbacks that prove a pass drew right: the partition's rectangles, the transparent
 *  occlusion test's rejections and the shadow atlas's fingerprint, never an image. */
export const webgpuAudits = (rt: WebgpuPagesRuntime): Audits => ({
  partitionAudit() {
    return readPartitionAudit(rt);
  },
  transparentOcclusionAudit() {
    return readTransparentOcclusionAudit(rt);
  },
  shadowAtlasDigest() {
    const atlas = rt.lights.shadows;
    if (rt.run.lost || !rt.gpu.device || !atlas?.texture) return Promise.resolve(null);
    return readShadowAtlasDigest(rt.gpu.device, atlas.texture, atlas.size);
  },
});
