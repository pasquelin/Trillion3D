import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { ReflectionHistoryFrame } from './historyRuntime.ts';

const frames = new WeakMap<object, ReflectionHistoryFrame>();

export function updateScreenReflection(
  rt: WebgpuPagesRuntime,
  matrix: ArrayLike<number>,
  enabled: boolean,
) {
  rt.gpu.reflection?.update(matrix, enabled, rt.gpu.targetSize, reflectionFrame(rt));
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
  const shadowEpoch = lights.shadowPagesTotal;
  const deformationEpoch = vis.deformation?.frame.revision ?? 0;
  let frame = frames.get(gpu.reflection);
  if (!frame) {
    frame = {
      metadata: { depth: gpu.depthTexture, normal: gpu.surfaces.normalRough, ids: vis.visTexture },
      pages: vis.pageTable,
      motion: vis.pageTable,
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
  // The shared helper's motion branch is disabled: every source pose change invalidates.
  // No second placement table is created when the host has disabled TAA.
  frame.motion = gpu.temporal?.motion.buffer ?? vis.pageTable;
  frame.epoch = `${scene}/${resources}/${rowEpoch}/${lightEpoch}/${proxyEpoch}/${radianceEpoch}/${shadowEpoch}/${deformationEpoch}`;
  frame.seed =
    (Math.imul(scene, 747796405) ^
      resources ^
      rowEpoch ^
      lightEpoch ^
      proxyEpoch ^
      radianceEpoch ^
      shadowEpoch ^
      deformationEpoch) >>>
    0;
  frame.frame = run.frame;
  frame.camera = run.gate.cam.viewProjection;
  return frame;
}
