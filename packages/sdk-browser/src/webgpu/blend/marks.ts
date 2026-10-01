import { isCancelled } from '../../backend/common.ts';
import { BLEND_SHADOW_MARKS_PASS } from '../shadow/allocPass.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { drawBlendRuns } from './draw.ts';
import { voidStaleBlendGroups } from './identity.ts';
import { blendLightResources } from './lighting.ts';
import { BLEND_MARKS_BINDINGS, BLEND_MARKS_GROUP, blendShadowMarksWgsl } from './marksWgsl.ts';
import { blendStagePipelines, stageDescriptors, type RankedPipelines } from './stagePipelines.ts';
import { composesWater } from '../water/pass.ts';

/** The three cull modes picked by plan rank, as the blend and water passes pick theirs. */
const ranked = (culls: readonly GPURenderPipeline[]): RankedPipelines => ({
  at: (rank) => culls[rank % culls.length],
});

/**
 * The marks pass of the transparent runs (`marksWgsl.ts`): its three cull modes on the blend
 * pass's layout per fragment stage — the blends' and, `water`, the water surfaces', else compiled
 * on the first image that marks water — and the group of the request buffer it marks, the opaque
 * depth it tests against and the deferred view, kept while they stay the same.
 */
async function createBlendShadowMarks(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  pages: number,
  water: boolean,
) {
  const module = device.createShaderModule({
    label: BLEND_SHADOW_MARKS_PASS,
    code: blendShadowMarksWgsl(pages),
  });
  const fragment = GPUShaderStage.FRAGMENT,
    b = BLEND_MARKS_BINDINGS;
  const marksLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.requests, visibility: fragment, buffer: { type: 'storage' } },
      { binding: b.depth, visibility: fragment, texture: { sampleType: 'depth' } },
      { binding: b.view, visibility: fragment, buffer: { type: 'uniform' } },
    ],
  });
  // No colour target, no depth write: the request buffer is all the pass writes. Its group goes
  // third (`BLEND_MARKS_GROUP`), after the blend pass's material and reflection groups.
  const stage = (entryPoint: string): GPUFragmentState => ({ module, entryPoint, targets: [] });
  const [blends, waterCulls] = await Promise.all([
    blendStagePipelines(device, module, layout, stage('markShadows'), false, marksLayout),
    water
      ? blendStagePipelines(device, module, layout, stage('markWaterShadows'), false, marksLayout)
      : undefined,
  ]);
  let waterMarks = waterCulls && ranked(waterCulls);
  let bound:
    | { requests: GPUBuffer; depth: GPUTextureView; view: GPUBuffer; group: GPUBindGroup }
    | undefined;
  return {
    pipelines: ranked(blends),
    /** The water surfaces' (`markWaterShadows`). */
    water() {
      return (waterMarks ??= ranked(
        stageDescriptors(device, module, layout, stage('markWaterShadows'), false, marksLayout).map(
          (descriptor) => device.createRenderPipeline(descriptor),
        ),
      ));
    },
    group(requests: GPUBuffer, depth: GPUTextureView, view: GPUBuffer) {
      if (bound?.requests === requests && bound.depth === depth && bound.view === view)
        return bound.group;
      const group = device.createBindGroup({
        layout: marksLayout,
        entries: [
          { binding: b.requests, resource: { buffer: requests } },
          { binding: b.depth, resource: depth },
          { binding: b.view, resource: { buffer: view } },
        ],
      });
      bound = { requests, depth, view, group };
      return group;
    },
  };
}

export type BlendShadowMarks = Awaited<ReturnType<typeof createBlendShadowMarks>>;

/** The marks of a scene that draws transparents and marks its shadow pages (`lights.demand`): none
 *  without them, nor on a device that refuses the pass — they then read the opaque's pages. */
export async function prepareBlendShadowMarks(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState, vis, lights, diag } = rt;
  blendState.shadowMarks = undefined;
  if (!lights.demand || !blendState.blendGpu.length || !vis.blendBindGroupLayout) return;
  blendState.shadowMarks = await createBlendShadowMarks(
    device,
    vis.blendBindGroupLayout,
    lights.plan.sunWindow,
    !!blendState.water,
  ).catch((error) => {
    if (isCancelled(rt.signal)) throw error;
    diag.diagnosticFailure('blend-shadow-marks-unavailable', error);
    return undefined;
  });
}

/**
 * The transparent runs of the image, expanded when they were prepared (`prepareBlend`), drawn into
 * the marks pass after the opaque demand, before the allocation: every page a transparent fragment
 * reads is asked for in the frame it reads it, mapped and drawn there, never left to a coarser
 * level — the blends' (#1411), and the transmission slice's (#1412) as the water composite reads
 * them, or as a blend when that slice draws as one (`encodeWaterPass`). The pass tests the opaque
 * depth read-only and binds the blend pass's own groups, its lighting resolved first.
 */
export function encodeBlendShadowMarks(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { blendState, gpu, lights } = rt,
    marks = blendState.shadowMarks,
    requests = lights.pageRequests?.buffer,
    view = gpu.deferred?.uniform;
  if (!marks || !requests || !view || !lights.shadows?.texture || !gpu.depthView) return;
  // A diagnostic view lights no transparent (`FLAG_DIAGNOSTIC_VIEW`): no fragment would mark.
  if (rt.run.diagnostic !== 'beauty') return;
  const [blends, transmissive] = blendState.runCount;
  if (!(blends || transmissive) || !blendState.argsBuffer) return;
  voidStaleBlendGroups(rt, blendLightResources(rt));
  const pass = encoder.beginRenderPass({
    label: BLEND_SHADOW_MARKS_PASS,
    colorAttachments: [],
    depthStencilAttachment: { view: gpu.depthView, depthReadOnly: true },
  });
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1);
  pass.setBindGroup(BLEND_MARKS_GROUP, marks.group(requests, gpu.depthView, view));
  if (blends) rt.run.gpuDrawCalls += drawBlendRuns(rt, device, pass, 0, marks.pipelines);
  if (transmissive) {
    const water = composesWater(rt, true) && blendState.transmissiveInView > 0;
    const pipelines = water ? marks.water() : marks.pipelines;
    rt.run.gpuDrawCalls += drawBlendRuns(rt, device, pass, 1, pipelines);
  }
  pass.end();
}
