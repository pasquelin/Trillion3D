import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { shadowEpoch } from '../webgpu/pages/state/shadowEpoch.ts';
import { materialEpoch } from '../webgpu/pages/io/refreshMaterials.ts';
import {
  REFLECTION_LIGHTING_VERSIONS,
  REFLECTION_PLACEMENT_VERSIONS,
  type ReflectionHistoryFrame,
} from './historyFrame.ts';

const frames = new WeakMap<object, ReflectionHistoryFrame>();

/** The placement motion the temporal pass writes before this image's submission, live only while
 *  that pass accumulates; the page table otherwise, bound and never read. */
export function liveMotion(rt: WebgpuPagesRuntime, pages: GPUBuffer) {
  const temporal = rt.gpu.temporal?.frame.active ? rt.gpu.temporal : undefined;
  return temporal ? temporal.motion.buffer : pages;
}

/** The versions that place what a reflection shows, written into `into`: the scene, residency,
 *  poses, the bounce proxy, the probes and shadows they redraw, deformation. Each comes from its
 *  writer; a moved point is followed by the placement motion, and its shadow and bounce move with
 *  it: a camera move alone redraws shadow pages, and the probes encode every image a mover turns. */
export function placementEpoch(
  rt: WebgpuPagesRuntime,
  into: Float64Array = new Float64Array(REFLECTION_PLACEMENT_VERSIONS),
) {
  const { vis, run, layout, lights, bounce } = rt;
  into[0] = run.gate.revisions.scene;
  into[1] = run.gate.revisions.resources;
  into[2] = layout.rows.tableEpoch;
  into[3] = bounce.probes?.proxy.revision ?? 0;
  into[4] = bounce.probes?.encodedFrames ?? 0;
  into[5] = shadowEpoch(lights);
  into[6] = vis.deformation?.frame.revision ?? 0;
  return into;
}

/** The versions that light it: the lights' transport and the materials' values. No motion brings
 *  an old lighting to the new one: their change resets the history (`historyRuntime.ts`). */
function lightingEpoch(rt: WebgpuPagesRuntime, into: Float64Array) {
  into[0] = rt.lights.store.transportEpoch;
  into[1] = materialEpoch(rt);
}

/** Versions come from their writers: receiver motion alone cannot describe a
 * reflection's dependency on a moving, relit or newly resident reflected object. */
export function reflectionFrame(rt: WebgpuPagesRuntime): ReflectionHistoryFrame | undefined {
  const { gpu, vis, run } = rt;
  if (
    !gpu.reflection?.history ||
    !gpu.depthTexture ||
    !gpu.surfaces ||
    !vis.visTexture ||
    !vis.pageTable
  )
    return undefined;
  let frame = frames.get(gpu.reflection);
  if (!frame) {
    frame = {
      metadata: { depth: gpu.depthTexture, normal: gpu.surfaces.normalRough, ids: vis.visTexture },
      pages: vis.pageTable,
      motion: vis.pageTable,
      eye: run.gate.cam.eye,
      epoch: new Float64Array(REFLECTION_PLACEMENT_VERSIONS),
      lighting: new Float64Array(REFLECTION_LIGHTING_VERSIONS),
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
  // motion then stands still, a pose change keeps the history at the change weight
  // (`REFLECTION_CHANGE_WEIGHT`). No second table is made.
  frame.motion = liveMotion(rt, vis.pageTable);
  frame.eye = run.gate.cam.eye;
  const { epoch, lighting } = frame;
  placementEpoch(rt, epoch);
  lightingEpoch(rt, lighting);
  // Every version mixed, the scene's scrambled: independent of wall clock.
  let seed = Math.imul(epoch[0], 747796405);
  for (let i = 1; i < epoch.length; i++) seed ^= epoch[i];
  for (let i = 0; i < lighting.length; i++) seed ^= lighting[i];
  frame.seed = seed >>> 0;
  frame.frame = run.frame;
  frame.camera = run.gate.cam.viewProjection;
  return frame;
}
