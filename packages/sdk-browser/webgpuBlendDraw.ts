import { BLEND_VIEW_SIZE } from './webgpuBlendUniforms.ts';
import { feedbackAttachment } from './webgpuPagesAttachments.ts';
import { blendBindEntries, type BlendLighting } from './webgpuBindEntries.ts';
import { blendLightResources } from './webgpuBlendLighting.ts';
import { voidStaleBlendGroups } from './webgpuBlendIdentity.ts';
import { createBlendOverdraw } from './webgpuBlendOverdraw.ts';
import { countsBlendOverdraw } from './diagnosticGpuVariant.ts';
import { VOLUME_SIZE, VOLUME_STRIDE } from './webgpuTransmission.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import { PIPELINE_BACK, PIPELINE_FRONT, planPipeline } from './webgpuBlendPlan.ts';
import { RUN_SHARED, RUN_WORDS, runOwner } from './webgpuBlendRuns.ts';
import { itemKept } from './webgpuBlendExpandCpu.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Bind group of a blend pass: vertex buffers, item records, atlases and lighting. A paged item
 * reads the page cache and the concatenated geometry, so ALL paged items share this group; an
 * unpaged item carries its own buffers and keeps its own.
 */
function blendBindGroup(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  item: BlendGpuItem | undefined,
  lighting: BlendLighting,
) {
  const { gpu, vis, blendState } = rt,
    compaction = blendState.compaction,
    zero = gpu.zeroUv!;
  return device.createBindGroup({
    layout: vis.blendBindGroupLayout!,
    entries: blendBindEntries({
      indices: item?.index ?? gpu.cache!.buffer,
      positions: item?.position ?? vis.concatPos!,
      uvs: item ? (item.uv ?? zero) : vis.concatUv!,
      uniform: blendState.viewBuffer!,
      uniformSize: BLEND_VIEW_SIZE,
      items: blendState.itemBuffer!,
      textures: vis.textures!,
      sampler: vis.mapsSampler!,
      normals: item ? (item.normal ?? zero) : vis.concatNrm!,
      ...lighting,
      clusterDiagnostic: compaction?.diagnosticBuffer ?? zero,
      planInstances: blendState.expandedBuffer ?? zero,
      clusterSpans: compaction?.spanBuffer ?? zero,
      volume: gpu.volumeBuffer!,
      volumeSize: VOLUME_SIZE,
      backdrop: gpu.backdrop!.colorView,
      backdropDepth: gpu.backdrop!.depthView,
    }),
  });
}

/**
 * Encodes a transparent pass: one `drawIndirect` per RUN, and nothing else.
 *
 * A run is a stretch of sorted-plan entries that set the same pipeline and read the same
 * buffers (`webgpuBlendRuns.ts`). Draw primitives are rasterized instance by instance, in
 * order: the GPU-expanded list therefore carries each entry's instances in sequence, farthest
 * first, and the paint order is the one a draw per item used to give — without the draws. A
 * scene of paged primitives that share a pipeline fits in one draw; an unpaged item, which
 * carries its own buffers, keeps its own.
 *
 * The loop does no matrix product, no material read, no frustum test: the frustum verdict is
 * set with the sort keys (`webgpuBlendOrder.ts`), and all that remains here is not to encode
 * the draw of an item wholly out of view.
 *
 * `transmissive` says which of the two passes is encoded: blends first, then, once the
 * background is frozen, the surfaces that reread it — one run per entry, each offsetting its
 * volume. Virtual-texture feedback is opened by `feedbackAttachment`, which alone knows whether
 * a pass of the frame already wrote it; the function says whether it opened a pass.
 */
/** Dynamic-offset array, allocated once: `setBindGroup` reads it in place. */
const offsets = [0];

export function drawBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  transmissive = false,
): boolean {
  const { gpu, vis, run, blendState } = rt,
    items = blendState.blendGpu,
    slice = transmissive ? 1 : 0,
    order = blendState.orders[slice],
    runs = blendState.runs[slice],
    count = blendState.runCount[slice],
    args = blendState.argsBuffer;
  if (!count || !args) return false;
  const lighting = blendLightResources(rt);
  voidStaleBlendGroups(rt, lighting);
  blendState.pagedGroup ??= blendBindGroup(rt, device, undefined, lighting);
  // Diagnostic only: the counting variant opens an occlusion query around the pass.
  const overdraw = countsBlendOverdraw(rt.context?.diagnosticGpuVariant)
    ? (blendState.overdraw ??= createBlendOverdraw(device))
    : undefined;
  const pass = encoder.beginRenderPass({
    label: transmissive ? 'WG transmission' : 'WG transparents',
    occlusionQuerySet: overdraw?.set,
    colorAttachments: [
      {
        view: vis.visEnabled && gpu.hdrView ? gpu.hdrView : gpu.colorView!,
        loadOp: 'load',
        storeOp: 'store',
      },
      // Virtual-texture feedback, opened by the first pass that writes it.
      feedbackAttachment(rt),
    ],
    depthStencilAttachment: { view: gpu.depthView!, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1);
  overdraw?.begin(pass, transmissive);
  let boundPipeline = -1,
    boundGroup: GPUBindGroup | undefined,
    encoded = 0;
  const base = blendState.planRegions[slice].args * 4;
  for (let index = 0; index < count; index++) {
    const at = index * RUN_WORDS,
      entry = order[runs[at]],
      owner = runOwner(entry, runs[at + 1]);
    // A run that names its item decides on the frustum bit: a draw that would set no pixel is not
    // encoded at all, as it was not per item. A run that merges several carries too many entries
    // to query one by one — the GPU zeros their instances, and a draw with no instance sets nothing.
    if (owner !== RUN_SHARED && !itemKept(blendState.keepPacked, owner)) continue;
    encoded++;
    if (boundPipeline !== planPipeline(entry)) {
      boundPipeline = planPipeline(entry);
      pass.setPipeline(
        boundPipeline === PIPELINE_FRONT
          ? vis.pipelineBlendFront!
          : boundPipeline === PIPELINE_BACK
            ? vis.pipelineBlendBack!
            : vis.pipelineBlendTextured!,
      );
    }
    const item = owner === RUN_SHARED ? undefined : items[owner];
    const group =
      item && !item.paged
        ? (item.group ??= blendBindGroup(rt, device, item, lighting))
        : blendState.pagedGroup!;
    // The material volume is the ONLY thing left to offset per item, and only the transmission
    // pass reads it: the blend pass sets its group once for the whole list. Offsets are read at
    // the call: one module array, rewritten, is enough.
    if (transmissive) {
      offsets[0] = (owner === RUN_SHARED ? 0 : owner) * VOLUME_STRIDE;
      pass.setBindGroup(0, group, offsets);
    } else if (group !== boundGroup) {
      offsets[0] = 0;
      pass.setBindGroup(0, (boundGroup = group), offsets);
    }
    pass.drawIndirect(args, base + index * 16);
  }
  overdraw?.end(pass);
  pass.end();
  overdraw?.after(encoder);
  run.gpuDrawCalls += encoded;
  run.blendDrawCalls += encoded;
  run.blendUnpagedTriangles += transmissive
    ? blendState.transmissionTriangles
    : blendState.blendTriangles;
  run.blendSubmittedTriangles = run.blendPagedTriangles + run.blendUnpagedTriangles;
  return true;
}
