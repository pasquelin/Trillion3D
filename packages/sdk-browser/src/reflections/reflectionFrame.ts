import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { shadowEpoch } from '../webgpu/pages/state/shadowEpoch.ts';
import { materialEpoch } from '../webgpu/pages/io/refreshMaterials.ts';
import type { ReflectionHistoryFrame } from './historyRuntime.ts';

const frames = new WeakMap<object, ReflectionHistoryFrame>();

/** The placement motion the temporal pass writes before this image's submission, live only while
 *  that pass accumulates; the page table otherwise, bound and never read. */
export function liveMotion(rt: WebgpuPagesRuntime, pages: GPUBuffer) {
  const temporal = rt.gpu.temporal?.frame.active ? rt.gpu.temporal : undefined;
  return temporal ? temporal.motion.buffer : pages;
}

/** The versions that place what a reflection shows: the scene, residency, poses, the bounce proxy,
 *  the probes and shadows they redraw, deformation. Each comes from its writer; a moved point is
 *  followed by the placement motion, and its shadow and bounce move with it: a camera move alone
 *  redraws shadow pages, and the probes encode every image a mover turns. */
export function placementEpoch(rt: WebgpuPagesRuntime) {
  const { vis, run, layout, lights, bounce } = rt;
  const { scene, resources } = run.gate.revisions;
  return `${scene}/${resources}/${layout.rows.tableEpoch}/${bounce.probes?.proxy.revision ?? 0}/${bounce.probes?.encodedFrames ?? 0}/${shadowEpoch(lights)}/${vis.deformation?.frame.revision ?? 0}`;
}

/** The versions that light it: the lights' transport and the materials' values. No motion brings
 *  an old lighting to the new one: their change resets the history (`historyRuntime.ts`). */
const lightingEpoch = (rt: WebgpuPagesRuntime) =>
  `${rt.lights.store.transportEpoch}/${materialEpoch(rt)}`;

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
      eye: run.gate.cam.eye,
      epoch: '',
      lighting: '',
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
  frame.eye = run.gate.cam.eye;
  frame.epoch = placementEpoch(rt);
  frame.lighting = lightingEpoch(rt);
  frame.seed =
    (Math.imul(scene, 747796405) ^
      resources ^
      rowEpoch ^
      lightEpoch ^
      proxyEpoch ^
      radianceEpoch ^
      shadowVersion ^
      deformationEpoch ^
      materialEpoch(rt)) >>>
    0;
  frame.frame = run.frame;
  frame.camera = run.gate.cam.viewProjection;
  return frame;
}
