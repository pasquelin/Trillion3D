import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { shadowEpoch } from '../webgpu/pages/state/shadowEpoch.ts';
import { REFLECTION_SOURCE_VERSIONS, type ReflectionHistoryFrame } from './historyRuntime.ts';

const frames = new WeakMap<object, ReflectionHistoryFrame>();

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
      epoch: new Float64Array(REFLECTION_SOURCE_VERSIONS),
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
  // The shared helper's motion branch is disabled: a source pose change lowers the history's
  // confidence instead (`REFLECTION_CHANGE_WEIGHT`).
  // No second placement table is created when the host has disabled TAA.
  frame.motion = gpu.temporal?.motion.buffer ?? vis.pageTable;
  const { epoch } = frame;
  epoch[0] = scene;
  epoch[1] = resources;
  epoch[2] = rowEpoch;
  epoch[3] = lightEpoch;
  epoch[4] = proxyEpoch;
  epoch[5] = radianceEpoch;
  epoch[6] = shadowVersion;
  epoch[7] = deformationEpoch;
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
