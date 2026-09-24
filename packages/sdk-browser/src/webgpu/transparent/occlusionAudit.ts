import { readGpuBuffer, readGpuTextureR32F } from '../../gpu/core/readback.ts';
import { visLayerTop } from '../visibility/uniforms.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { BOX_CORNER_VALUES, pageCornersInto } from '../../hiz/hiz.ts';

/**
 * What the transparent occlusion test REJECTED on the last image, and enough to refute it without
 * believing anything of the GPU.
 *
 * Each rejected cluster comes out with its world corners in double precision and the image's
 * matrices; the image depth comes with it, full resolution, as the opaque pass left it. A caller
 * therefore redoes the reference projection, takes the depth maximum on the REFERENCE rectangle —
 * the tighter of the two — and checks that the reference bound is still beyond: the cluster was
 * indeed entirely behind the opaque.
 *
 * This is not a pass of the image: nothing exists until the host asks for it.
 */
export interface TransparentOcclusionAudit {
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Nearest distance. */
  near: number;
  /** The camera's view matrix. */
  view: Float64Array;
  /** The camera's view-projection. */
  viewProj: Float64Array;
  /** Coplanar layer whose bias served every entry: the highest of the image. */
  layer: number;
  /** Table entries the test rejected, in table order. */
  rejected: Uint32Array;
  /** World corners of rejected entries, eight per entry, in the same order. */
  corners: Float64Array;
  /** Image depth, one float per pixel, row by row from the top. */
  depth: Float32Array;
  /** Entries the test examined: all those that name a page. */
  examined: number;
}

export async function readTransparentOcclusionAudit(
  rt: WebgpuPagesRuntime,
): Promise<TransparentOcclusionAudit | null> {
  const { blendState, layout, vis, run } = rt,
    device = rt.gpu.device,
    table = blendState.table,
    compaction = blendState.compaction,
    frame = vis.gpuPartition?.lastFrame;
  if (
    run.lost ||
    !device ||
    !table ||
    !compaction ||
    !blendState.occlusion ||
    !frame ||
    !vis.gpuHiz
  )
    return null;
  const words = await readGpuBuffer(device, compaction.occludedBuffer, table.capacity * 4);
  // A backend closed or lost while the read was in flight reads nothing more.
  if (!words || run.lost || !vis.gpuHiz) return null;
  const verdicts = new Uint32Array(words.buffer, words.byteOffset, table.capacity);
  const keep: number[] = [];
  let examined = 0;
  for (let entry = 0; entry < table.capacity; entry++) {
    if (table.pageOfEntry[entry] < 0) continue;
    examined++;
    if (verdicts[entry]) keep.push(entry);
  }
  const depth = await readGpuTextureR32F(device, vis.gpuHiz.level0, frame.width, frame.height);
  if (!depth) return null;
  const rejected = Uint32Array.from(keep);
  const corners = new Float64Array(rejected.length * BOX_CORNER_VALUES);
  const { packedPages } = layout;
  for (let i = 0; i < rejected.length; i++) {
    const page = table.pageOfEntry[rejected[i]];
    pageCornersInto(corners, i * BOX_CORNER_VALUES, packedPages[page]);
  }
  return {
    width: frame.width,
    height: frame.height,
    near: frame.near,
    view: frame.view,
    viewProj: frame.viewProj,
    layer: visLayerTop(vis),
    rejected,
    corners,
    depth,
    examined,
  };
}
