import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { shadowEpoch } from '../webgpu/pages/state/shadowEpoch.ts';
import type { ReflectionHistoryFrame } from './historyRuntime.ts';
import type { ReflectionSourceInputs } from './source.ts';

const frames = new WeakMap<object, ReflectionHistoryFrame>();
const sources = new WeakMap<object, ReflectionSourceInputs>();

export function updateScreenReflection(
  rt: WebgpuPagesRuntime,
  matrix: ArrayLike<number>,
  enabled: boolean,
) {
  rt.gpu.reflection?.update(
    matrix,
    enabled,
    rt.gpu.targetSize,
    reflectionFrame(rt),
    reflectionSourceInputs(rt),
  );
}

/** The placement motion the temporal pass writes before this image's submission, live only while
 *  that pass accumulates; the page table otherwise, bound and never read. */
function liveMotion(rt: WebgpuPagesRuntime, pages: GPUBuffer) {
  const temporal = rt.gpu.temporal?.frame.active ? rt.gpu.temporal : undefined;
  return temporal ? temporal.motion.buffer : pages;
}

/** What the last lit image is reprojected from: the HDR target it still holds (`encode.ts`). */
export function reflectionSourceInputs(rt: WebgpuPagesRuntime) {
  const { gpu, vis, run } = rt;
  if (!gpu.reflection?.active || !gpu.hdrView || !vis.visView || !vis.pageTable) return undefined;
  let inputs = sources.get(gpu.reflection);
  if (!inputs) sources.set(gpu.reflection, (inputs = {} as ReflectionSourceInputs));
  inputs.last = gpu.hdrView;
  inputs.ids = vis.visView;
  inputs.pages = vis.pageTable;
  inputs.motion = liveMotion(rt, vis.pageTable);
  inputs.reprojects = inputs.motion !== vis.pageTable;
  inputs.eye = run.gate.cam.eye;
  return inputs;
}

/** Versions come from their writers: receiver motion alone cannot describe a
 * reflection's dependency on a moving, relit or newly resident reflected object. */
export function reflectionFrame(rt: WebgpuPagesRuntime): ReflectionHistoryFrame | undefined {
  const { gpu, vis, run, layout, lights, bounce } = rt;
  if (
    !gpu.reflection?.history ||
    !gpu.depthTexture ||
    !gpu.surfaces ||
    !vis.visTexture ||
    !vis.pageTable
  )
    return undefined;
  const { scene, resources } = run.gate.revisions;
  const rowEpoch = layout.rows.tableEpoch;
  const lightEpoch = lights.store.transportEpoch;
  const proxyEpoch = bounce.probes?.proxy.revision ?? 0;
  const radianceEpoch = bounce.probes?.encodedFrames ?? 0;
  const shadowVersion = shadowEpoch(lights);
  const deformationEpoch = vis.deformation?.frame.revision ?? 0;
  let frame = frames.get(gpu.reflection);
  if (!frame) {
    frame = {
      metadata: { depth: gpu.depthTexture, normal: gpu.surfaces.normalRough, ids: vis.visTexture },
      pages: vis.pageTable,
      motion: vis.pageTable,
      reprojects: false,
      eye: run.gate.cam.eye,
      epoch: '',
      seed: 0,
      frame: -1,
      camera: run.gate.cam.viewProjection,
    };
    frames.set(gpu.reflection, frame);
  }
  frame.metadata.depth = gpu.depthTexture;
  frame.metadata.normal = gpu.surfaces.normalRough;
  frame.metadata.ids = vis.visTexture;
  frame.pages = vis.pageTable;
  // Moved sources are reprojected through the temporal pass's motion; without that pass, whose
  // motion then stands still, a pose change resets the history. No second table is made.
  frame.motion = liveMotion(rt, vis.pageTable);
  frame.reprojects = frame.motion !== vis.pageTable;
  frame.eye = run.gate.cam.eye;
  frame.epoch = `${scene}/${resources}/${rowEpoch}/${lightEpoch}/${proxyEpoch}/${radianceEpoch}/${shadowVersion}/${deformationEpoch}`;
  frame.seed =
    (Math.imul(scene, 747796405) ^
      resources ^
      rowEpoch ^
      lightEpoch ^
      proxyEpoch ^
      radianceEpoch ^
      shadowVersion ^
      deformationEpoch) >>>
    0;
  frame.frame = run.frame;
  frame.camera = run.gate.cam.viewProjection;
  return frame;
}
