import { feedbackAttachment } from '../pages/prepare/attachments.ts';
import { blendEntries } from './identity.ts';
import { createBlendOverdraw } from './overdraw.ts';
import { countsBlendOverdraw } from '../../diagnostic/gpuVariant.ts';
import type { BlendGpuItem } from './state.ts';
import type { RankedPipelines } from './stagePipelines.ts';
import { planPipeline } from './plan.ts';
import { RUN_SHARED, RUN_WORDS, runOwner } from './runs.ts';
import { itemKept } from './expandCpu.ts';
import { routedFilter, type DisplayFilter } from './displayFilter.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { activeAsIsShare } from '../pages/prepare/asIsShareTarget.ts';

/**
 * Bind group of a blend pass: vertex buffers, item records, atlases and lighting. A paged item
 * reads its quantized pages in the page cache, or the concatenated geometry of a cache without
 * them, so ALL paged items share this group; an unpaged item carries its own buffers and keeps
 * its own.
 */
function blendBindGroup(rt: WebgpuPagesRuntime, device: GPUDevice, item: BlendGpuItem | undefined) {
  return device.createBindGroup({
    layout: rt.vis.blendBindGroupLayout!,
    entries: item
      ? blendEntries(rt, item)
      : (rt.blendState.identity.entries[0] ??= blendEntries(rt)),
  });
}

/**
 * Encodes the runs of a pass into an open render pass: one `drawIndirect` per RUN, and nothing else.
 *
 * A run is a stretch of sorted-plan entries that set the same pipeline and read the same
 * buffers (`runs.ts`). Draw primitives are rasterized instance by instance, in
 * order: the GPU-expanded list therefore carries each entry's instances in sequence, farthest
 * first, and the paint order is the one a draw per item used to give — without the draws. A
 * scene of paged primitives that share a pipeline fits in one draw; an unpaged item, which
 * carries its own buffers, keeps its own.
 *
 * The loop does no matrix product, no material read, no frustum test: the frustum verdict is
 * set with the sort keys (`order.ts`), and all that remains here is not to encode
 * the draw of an item wholly out of view.
 *
 * `slice` says which pass is encoded — blends, or the water surfaces — and `pipelines` what
 * draws it, with the display layers `filter` attached and its mask bound; the bind groups are the
 * same, and they are the blend pass's. Returns the draws encoded.
 */
export function drawBlendRuns(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  slice: number,
  pipelines: RankedPipelines,
  filter?: DisplayFilter,
  share = false,
) {
  const { blendState } = rt,
    items = blendState.blendGpu,
    order = blendState.orders[slice],
    runs = blendState.runs[slice],
    count = blendState.runCount[slice],
    args = blendState.argsBuffer!;
  if (rt.gpu.reflection) pass.setBindGroup(1, rt.gpu.reflection.group);
  if (filter) pass.setBindGroup(2, filter.maskGroup);
  blendState.pagedGroup ??= blendBindGroup(rt, device, undefined);
  let boundPipeline = -1,
    boundGroup: GPUBindGroup | undefined,
    encoded = 0;
  const base = blendState.planRegions[slice].args * 4;
  for (let index = 0; index < count; index++) {
    const at = index * RUN_WORDS,
      entry = order[runs[at]],
      owner = runOwner(order, runs[at], runs[at + 1]);
    if (pipelines.skips?.(planPipeline(entry))) continue;
    // A run that names its item decides on the frustum bit: a draw that would set no pixel is not
    // encoded at all, as it was not per item. A run that merges several carries too many entries
    // to query one by one — the GPU zeros their instances, and a draw with no instance sets nothing.
    if (owner !== RUN_SHARED && !itemKept(blendState.keepPacked, owner)) continue;
    encoded++;
    if (boundPipeline !== planPipeline(entry)) {
      boundPipeline = planPipeline(entry);
      // The blend pass compiles a mode first written after it was built (`pipelines.ts`).
      const pipeline = pipelines.at(boundPipeline, !!filter, share);
      if (!pipeline) throw new Error(`blend pipeline ${boundPipeline} was not built for the scene`);
      pass.setPipeline(pipeline);
    }
    const item = owner === RUN_SHARED ? undefined : items[owner];
    const group =
      item && !item.paged
        ? (item.group ??= blendBindGroup(rt, device, item))
        : blendState.pagedGroup!;
    // Nothing is offset per item: the record is read at the rank the vertex index carries, so the
    // group is set once for the whole list, and again only for an unpaged item's own buffers.
    if (group !== boundGroup) pass.setBindGroup(0, (boundGroup = group));
    pass.drawIndirect(args, base + index * 16);
  }
  return encoded;
}

/**
 * Encodes a forward transparent pass over the lit image: the blends, or — under a diagnostic
 * view or variant, which see it as one more blend — the transmission slice. Virtual-texture
 * feedback is opened by `feedbackAttachment`, which alone knows whether a pass of the frame
 * already wrote it; the function says whether it opened a pass.
 */
export function drawBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  transmissive = false,
): boolean {
  const { gpu, vis, blendState } = rt,
    slice = transmissive ? 1 : 0,
    // The transmission slice routes through the mask the blends drew, if they drew one.
    filter = transmissive
      ? routedFilter(gpu.displayFilter)
      : gpu.displayFilter?.active
        ? gpu.displayFilter
        : undefined;
  // Nothing to encode without runs, or without the arguments the GPU wrote for them.
  if (!blendState.runCount[slice] || !blendState.argsBuffer) return false;
  if (filter && !transmissive) drawDisplayMask(rt, device, encoder, filter);
  const share = activeAsIsShare(rt);
  // Diagnostic only: the counting variant opens an occlusion query around the pass.
  const overdraw = countsBlendOverdraw(rt.context?.diagnosticGpuVariant)
    ? (blendState.overdraw ??= createBlendOverdraw(device))
    : undefined;
  const pass = encoder.beginRenderPass({
    label: transmissive ? 'Trillion3D transmission' : 'Trillion3D transparents',
    occlusionQuerySet: overdraw?.set,
    colorAttachments: [
      {
        view: vis.visEnabled && gpu.hdrView ? gpu.hdrView : gpu.colorView!,
        loadOp: 'load',
        storeOp: 'store',
      },
      // Virtual-texture feedback, opened by the first pass that writes it.
      ...(rt.feedbackAB?.target === false ? [] : [feedbackAttachment(rt)]),
      // The share a debug view or the temporal pass reads; an empty slot otherwise (#365).
      share ? { view: share.view, loadOp: 'load', storeOp: 'store' } : null,
      // The display layers of an image whose blends filter (`displayFilter.ts`).
      ...(filter ? filter.attachments() : []),
    ],
    depthStencilAttachment: { view: gpu.depthView!, depthReadOnly: true },
  });
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1);
  overdraw?.begin(pass, transmissive);
  const encoded = drawBlendRuns(rt, device, pass, slice, vis.blendPipelines!, filter, !!share);
  overdraw?.end(pass);
  pass.end();
  overdraw?.after(encoder);
  countBlendDraws(rt, encoded, transmissive);
  return true;
}

/** The display mask: the blends' filtering surfaces alone, depth-tested, before the blend pass. */
function drawDisplayMask(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  filter: DisplayFilter,
) {
  const { gpu, run } = rt,
    { mask } = rt.vis.blendPipelines!;
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D display mask',
    colorAttachments: [...Array<null>(mask.slot).fill(null), filter.maskAttachment()],
    depthStencilAttachment: { view: gpu.depthView!, depthReadOnly: true },
  });
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1);
  run.gpuDrawCalls += drawBlendRuns(rt, device, pass, 0, mask);
  pass.end();
}

/** Frame counters of a transparent pass: draws, and the unpaged triangles it submits. */
export function countBlendDraws(rt: WebgpuPagesRuntime, encoded: number, transmissive: boolean) {
  const { run, blendState } = rt;
  run.gpuDrawCalls += encoded;
  run.blendDrawCalls += encoded;
  run.blendUnpagedTriangles += transmissive
    ? blendState.transmissionTriangles
    : blendState.blendTriangles;
  run.blendSubmittedTriangles = run.blendPagedTriangles + run.blendUnpagedTriangles;
}
