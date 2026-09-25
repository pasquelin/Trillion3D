import { followLightThreshold } from '../prepare/lightResources.ts';
import { normalizeVector3, type ShadowViewpoint } from '../../../../../sdk-core/src/index.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { EngineCamera } from '../../../camera/world.ts';
import { pixelNearOf } from '../../../streaming/priority.ts';
import { writeShadowPages, writeShadowRecords } from '../../shadow/pages.ts';
import { createShadowStaticLayer } from '../../../gpu/shadow/staticLayer.ts';
import { createShadowPageHiz } from '../../../gpu/shadow/pageHiz.ts';
import { createShadowOcclusion } from '../../../gpu/shadow/occlusion.ts';
import { noteResidenceChange } from '../../shadow/bounds.ts';
import { redrawShortPages } from '../../shadow/casters.ts';

const viewpoint: ShadowViewpoint & {
  position: [number, number, number];
  forward: [number, number, number];
} = {
  position: [0, 0, 0],
  forward: [0, 0, -1],
  halfFovY: 0.5,
  aspect: 1,
  near: 0.1,
  far: 1000,
  pixelNear: 1e-3,
};

/**
 * View the scheduler reads: position, axis, vertical half-fov, aspect, near and far planes, and
 * the pixel's footprint at the near plane. A sun's clipmap derives entirely from it — its windows
 * follow the camera, its finest level is that footprint's.
 */
export function shadowViewpointOf(cam: EngineCamera, height: number) {
  // Read in the world matrix image entry copied, ancestors included: the axis is that of
  // `Camera.getWorldDirection`, third column normalised then negated.
  const world = cam.world;
  viewpoint.position[0] = cam.eye[0];
  viewpoint.position[1] = cam.eye[1];
  viewpoint.position[2] = cam.eye[2];
  const forward = viewpoint.forward;
  forward[0] = world[8];
  forward[1] = world[9];
  forward[2] = world[10];
  normalizeVector3(forward);
  forward[0] = -forward[0];
  forward[1] = -forward[1];
  forward[2] = -forward[2];
  viewpoint.halfFovY = Math.max(1e-3, (cam.fov * Math.PI) / 360);
  viewpoint.aspect = Math.max(1e-3, cam.aspect);
  viewpoint.near = cam.near;
  viewpoint.far = cam.far;
  viewpoint.pixelNear = pixelNearOf(cam.projection, height, cam.near);
  return viewpoint;
}

/**
 * Plans this image's shadow pages — the stale ones the image reads, within budget — and writes,
 * for each, its matrix, its cull volume and its physical page, then every light's record and the
 * page-table words that changed. Returns the pages to draw.
 */
export function planShadowRegions(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  frame: number,
  nowMs: number,
) {
  const { lights } = rt,
    { shadows, plan, store, runs, regions } = lights,
    { rows, packedPages } = rt.layout;
  runs.reset();
  regions.reset();
  // Residency this frame's light cuts see changed since the last plan: those pages alone restale.
  let residencyMoved = false;
  const { residentFlags, residentOffsetWords } = rows;
  lights.residence.flush(residentFlags, residentOffsetWords, rt.run.gpuFrameActive, (page) => {
    residencyMoved = true;
    noteResidenceChange(lights, packedPages[page]);
  });
  lights.shadowPages = 0;
  lights.shadowDraws = 0;
  lights.shadowDrawCalls = 0;
  // An atlas not sized yet holds no page: nothing to plan before the first frame on the canvas.
  if (!shadows?.view || !store.count) {
    plan.releaseDeferred();
    return 0;
  }
  // The light cuts measure their error at the camera's threshold.
  const pixelError = followLightThreshold(lights, rt.run.gate.pixelError);
  const view = shadowViewpointOf(cam, rt.gpu.targetSize[1]);
  const box = lights.sceneBox(rt.layout);
  ensureStaticLayer(rt);
  redrawShortPages(rt, frame, nowMs, residencyMoved);
  plan.plan(store, view, box.min, box.max, frame, nowMs);
  const slots = writeShadowRecords(lights);
  const count = writeShadowPages(lights, slots, cam.eye, pixelError);
  lights.shadowPages = plan.admission.count;
  return count;
}

/**
 * Plans the image's shadow pages once. The CPU cut plans them before it writes its rows — the
 * light cuts' casters need rows too —, and the direct-lighting pass then reads the same plan:
 * its regions, one or two per page, never its page count. An unlit view, or a scene without
 * light, plans nothing and leaves no run behind.
 */
export function planImageShadows(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { lights, run } = rt,
    { store } = lights;
  if (!store.count || store.unlit) {
    lights.runs.reset();
    return 0;
  }
  if (lights.plannedFrame === run.frame) return lights.regions.count;
  lights.plannedFrame = run.frame;
  return planShadowRegions(rt, cam, run.frame, performance.now());
}

/**
 * Copies the shadow pages the resolve just asked for, stamped with the plan's state, for the
 * scheduler to read once the image is submitted (`../../shadow/pageRequests.ts`). An image that
 * lit nothing — unlit view, no light, no pool (no light casts a shadow) — asked for nothing and
 * copies nothing.
 */
export function encodeShadowReadback(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { lights, run, timing } = rt,
    { plan, store, pageRequests } = lights;
  if (!pageRequests || !lights.shadows?.texture || !store.count || store.unlit) return;
  const settle = pageRequests.copy(
    encoder,
    run.frame,
    plan.table.layoutEpoch,
    plan.stamp(store),
    plan.receive,
  );
  if (settle) timing.shadowPageRequests = settle;
}

/**
 * The static layer is built the first time an object moves, with the pyramids of its pages and
 * the occlusion test of the moving casters; until they are ready, pages are drawn whole, every
 * caster at once. A device that refuses the layer keeps drawing them so.
 */
function ensureStaticLayer(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    device = rt.gpu.device;
  if (!lights.mobility.layered || lights.staticLayer || lights.staticLayerPending || !device)
    return;
  lights.staticLayerPending = true;
  const capacity = rt.layout.rows.casterSlots;
  createShadowStaticLayer(device, lights.plan.pool.side)
    .then(async (layer) => {
      // The pyramids and the occlusion test read the layer: a device that refuses them keeps the
      // layer, and draws the moving casters untested.
      try {
        lights.pageHiz = await createShadowPageHiz(device, layer.view);
        lights.occlusion = await createShadowOcclusion(device, capacity);
      } catch (error) {
        lights.pageHiz?.dispose();
        lights.pageHiz = undefined;
        rt.diag.diagnosticFailure('shadow-occlusion-unavailable', error);
      }
      lights.staticLayer = layer;
    })
    .catch((error) => rt.diag.diagnosticFailure('shadow-static-layer-unavailable', error));
}
