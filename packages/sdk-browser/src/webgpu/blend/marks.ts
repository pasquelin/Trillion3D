import { isCancelled } from '../../backend/common.ts';
import { BLEND_SHADOW_MARKS_PASS } from '../shadow/allocPass.ts';
import { expandBlend, type BlendFrame } from '../pages/render/encodeBlend.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { drawBlendRuns } from './draw.ts';
import { voidStaleBlendGroups } from './identity.ts';
import { blendLightResources } from './lighting.ts';
import { BLEND_MARKS_BINDINGS, BLEND_MARKS_GROUP, blendShadowMarksWgsl } from './marksWgsl.ts';
import { blendStagePipelines, type RankedPipelines } from './stagePipelines.ts';

/**
 * The marks pass of the blend runs (`marksWgsl.ts`): its three cull modes on the blend pass's
 * layout, picked by the same plan rank, and the group of the request buffer it marks and the
 * opaque depth it tests against, kept while both stay the same.
 */
export async function createBlendShadowMarks(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  pages: number,
) {
  const module = device.createShaderModule({
    label: BLEND_SHADOW_MARKS_PASS,
    code: blendShadowMarksWgsl(pages),
  });
  const { requests, depth } = BLEND_MARKS_BINDINGS;
  const marksLayout = device.createBindGroupLayout({
    entries: [
      { binding: requests, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } },
      { binding: depth, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  });
  // No colour target, no depth write: the request buffer is all the pass writes. Its group goes
  // third (`BLEND_MARKS_GROUP`), after the blend pass's material and reflection groups.
  const fragment: GPUFragmentState = { module, entryPoint: 'markShadows', targets: [] };
  const culls = await blendStagePipelines(device, module, layout, fragment, false, marksLayout);
  const pipelines: RankedPipelines = { at: (rank) => culls[rank % culls.length] };
  let bound: { requests: GPUBuffer; depth: GPUTextureView; group: GPUBindGroup } | undefined;
  return {
    pipelines,
    group(requests: GPUBuffer, depth: GPUTextureView) {
      if (bound?.requests === requests && bound.depth === depth) return bound.group;
      const group = device.createBindGroup({
        layout: marksLayout,
        entries: [
          { binding: BLEND_MARKS_BINDINGS.requests, resource: { buffer: requests } },
          { binding: BLEND_MARKS_BINDINGS.depth, resource: depth },
        ],
      });
      bound = { requests, depth, group };
      return group;
    },
  };
}

export type BlendShadowMarks = Awaited<ReturnType<typeof createBlendShadowMarks>>;

/** The marks of a scene that draws blends and marks its shadow pages (`lights.demand`): none
 *  without them, nor on a device that refuses the pass — the blends then read the opaque's pages. */
export async function prepareBlendShadowMarks(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState, vis, lights, diag } = rt;
  blendState.shadowMarks = undefined;
  if (!lights.demand || !blendState.blendGpu.length || !vis.blendBindGroupLayout) return;
  blendState.shadowMarks = await createBlendShadowMarks(
    device,
    vis.blendBindGroupLayout,
    lights.plan.sunWindow,
  ).catch((error) => {
    if (isCancelled(rt.signal)) throw error;
    diag.diagnosticFailure('blend-shadow-marks-unavailable', error);
    return undefined;
  });
}

/**
 * The blend runs of the image, expanded now and drawn into the marks pass after the opaque
 * demand, before the allocation: every page a transparent fragment reads is asked for in the frame
 * it reads it, mapped and drawn there, never left to a coarser level (#1411). The pass tests the
 * opaque depth read-only and binds the blend pass's own groups, its lighting resolved first.
 */
export function encodeBlendShadowMarks(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  blend: BlendFrame,
) {
  const { blendState, gpu, lights } = rt,
    marks = blendState.shadowMarks,
    requests = lights.pageRequests?.buffer;
  if (!marks || !requests || !lights.shadows?.texture || !gpu.depthView) return;
  expandBlend(rt, device, encoder, blend);
  if (!blendState.runCount[0] || !blendState.argsBuffer) return;
  voidStaleBlendGroups(rt, blendLightResources(rt));
  const pass = encoder.beginRenderPass({
    label: BLEND_SHADOW_MARKS_PASS,
    colorAttachments: [],
    depthStencilAttachment: { view: gpu.depthView, depthReadOnly: true },
  });
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1);
  pass.setBindGroup(BLEND_MARKS_GROUP, marks.group(requests, gpu.depthView));
  rt.run.gpuDrawCalls += drawBlendRuns(rt, device, pass, 0, marks.pipelines);
  pass.end();
}
