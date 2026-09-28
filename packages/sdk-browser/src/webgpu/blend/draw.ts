import { feedbackAttachment } from '../pages/prepare/attachments.ts';
import { blendEntries } from './identity.ts';
import { createBlendOverdraw } from './overdraw.ts';
import { countsBlendOverdraw } from '../../diagnostic/gpuVariant.ts';
import type { BlendGpuItem } from './state.ts';
import type { RankedPipelines } from './stagePipelines.ts';
import { planPipeline } from './plan.ts';
import { RUN_SHARED, RUN_WORDS, runOwner } from './runs.ts';
import { itemKept } from './expandCpu.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

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
 * draws it, `filtered` with the display filter attached; the bind groups are the same, and they
 * are the blend pass's. Returns the draws encoded.
 */
export function drawBlendRuns(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  slice: number,
  pipelines: RankedPipelines,
  filtered = false,
) {
  const { blendState } = rt,
    items = blendState.blendGpu,
    order = blendState.orders[slice],
    runs = blendState.runs[slice],
    count = blendState.runCount[slice],
    args = blendState.argsBuffer!;
  if (rt.gpu.reflection) pass.setBindGroup(1, rt.gpu.reflection.group);
  blendState.pagedGroup ??= blendBindGroup(rt, device, undefined);
  let boundPipeline = -1,
    boundGroup: GPUBindGroup | undefined,
    encoded = 0;
  const base = blendState.planRegions[slice].args * 4;
  for (let index = 0; index < count; index++) {
    const at = index * RUN_WORDS,
      entry = order[runs[at]],
      owner = runOwner(order, runs[at], runs[at + 1]);
    // A run that names its item decides on the frustum bit: a draw that would set no pixel is not
    // encoded at all, as it was not per item. A run that merges several carries too many entries
    // to query one by one — the GPU zeros their instances, and a draw with no instance sets nothing.
    if (owner !== RUN_SHARED && !itemKept(blendState.keepPacked, owner)) continue;
    encoded++;
    if (boundPipeline !== planPipeline(entry)) {
      boundPipeline = planPipeline(entry);
      // The blend pass compiles a mode first written after it was built (`pipelines.ts`).
      const pipeline = pipelines.at(boundPipeline, filtered);
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
    filter = gpu.displayFilter?.active ? gpu.displayFilter : undefined;
  // Nothing to encode without runs, or without the arguments the GPU wrote for them.
  if (!blendState.runCount[slice] || !blendState.argsBuffer) return false;
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
      {
        view: gpu.asIsShare!.view,
        loadOp: 'load',
        storeOp: 'store',
      },
      // The display filter of an image whose blends filter (`displayFilter.ts`).
      ...(filter ? [{ view: filter.view, loadOp: 'load', storeOp: 'store' } as const] : []),
    ],
    depthStencilAttachment: { view: gpu.depthView!, depthReadOnly: true },
  });
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1);
  overdraw?.begin(pass, transmissive);
  const encoded = drawBlendRuns(rt, device, pass, slice, vis.blendPipelines!, !!filter);
  overdraw?.end(pass);
  pass.end();
  overdraw?.after(encoder);
  countBlendDraws(rt, encoded, transmissive);
  return true;
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
