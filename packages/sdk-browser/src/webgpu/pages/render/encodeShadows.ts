import { followLightThreshold } from '../prepare/lightResources.ts';
import {
  LIGHT_KIND,
  RECTS_PER_SLICE,
  SHADOW_CULL_FLOATS,
  SHADOW_PAGE,
  faceCountOf,
  normalizeVector3,
  pageRowsOf,
  regionRect,
  writeFace,
  type ShadowViewpoint,
} from '../../../../../sdk-core/src/index.ts';
import { MAX_SHADOW_REGIONS } from '../../../gpu/shadow/atlas.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { EngineCamera } from '../../../camera/world.ts';
import { writeDrawnMasks } from '../../shadow/drawnMask.ts';

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
};
const rectScratch = new Float64Array(4);
/**
 * Per region: the scissor that bounds it, then the viewport of its whole face. The viewport is the
 * face's, not the region's — it decides where a vertex lands, and keeping it whole is what makes
 * page drawing bit-identical to a full redraw. Only the scissor changes. Allocated once for an
 * image's budget.
 */
export const regionScissor = new Int32Array(MAX_SHADOW_REGIONS * 4);
export const regionViewport = new Int32Array(MAX_SHADOW_REGIONS * 3);

/**
 * View the scheduler reads: position, axis, vertical half-fov, aspect, near and far planes. The
 * sun's cascades derive entirely from it — they follow the camera and nothing else.
 */
export function shadowViewpointOf(cam: EngineCamera) {
  // Read in the world matrix image entry copied, ancestors included: the axis is that of
  // `Camera.getWorldDirection`, third column normalised then negated — same divide by length, same
  // sign, same bits.
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
  return viewpoint;
}

/**
 * Picks this image's shadow regions — page rectangles, not whole faces — and writes, for each, its
 * matrix and the volume culling opposes to it. Returns their count; each face's atlas rectangle is
 * already reserved by the scheduler.
 */
export function planShadowRegions(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  frame: number,
  nowMs: number,
) {
  const { lights } = rt,
    { shadows, cull, plan, store, faceMatrices, runs } = lights;
  runs.reset();
  lights.shadowsUpdated = 0;
  lights.shadowFaces = 0;
  lights.sunCascades = 0;
  lights.shadowRegions = 0;
  lights.shadowPages = 0;
  lights.shadowDraws = 0;
  lights.shadowDrawCalls = 0;
  if (!shadows || !store.count) {
    plan.releaseDeferred();
    return 0;
  }
  // The light cuts measure their error at the camera's threshold, budget included.
  const pixelError = followLightThreshold(lights, rt.run.gate.pixelError, rt.run.budgetPixelError);
  const view = shadowViewpointOf(cam);
  const count = plan.plan(store, view, frame, nowMs);
  const { regions, slices } = plan;
  let lastSlice = -1,
    lastFace = -1;
  for (let region = 0; region < count; region++) {
    const slice = regions.sliceOf(region),
      face = regions.faceOf(region);
    const light = store.light(store.ids[regions.lightOf(region)]);
    if (!light) continue;
    const side = slices.side[slice],
      rows = pageRowsOf(side);
    const x0 = regions.x0Of(region),
      x1 = regions.x1Of(region),
      y0 = regions.y0Of(region),
      y1 = regions.y1Of(region),
      shiftX = regions.shiftXOf(region),
      shiftY = regions.shiftYOf(region);
    const matrixBase = region * 16;
    // A new face closes the previous one's run while its view is still the last composed.
    const newFace = slice !== lastSlice || face !== lastFace;
    if (newFace) runs.close(cam.eye, pixelError);
    // The matrix and the volume are the extent's: the region rectangle is read in extent pages,
    // the physical rectangle minus the translation the draw applies.
    const planes = writeFace(
      faceMatrices,
      matrixBase,
      cull ? cull.volumes : null,
      region * SHADOW_CULL_FLOATS,
      light,
      face,
      view,
      side,
      regionRect(rectScratch, rows, x0 - shiftX, x1 - shiftX, y0 - shiftY, y1 - shiftY),
    );
    if (newFace) runs.open(region, side, rows, planes.near);
    runs.add(x0 - shiftX, x1 - shiftX, y0 - shiftY, y1 - shiftY, rectScratch);
    shadows.writeRegion(
      region,
      slice,
      face,
      faceMatrices,
      matrixBase,
      slices.rects,
      light.position,
      light.emitterRadius ?? 0,
      (2 * shiftX) / rows,
      (-2 * shiftY) / rows,
    );
    const rect = slice * RECTS_PER_SLICE + face * 3;
    const faceX = slices.rects[rect],
      faceY = slices.rects[rect + 1];
    const scissor = region * 4,
      viewport = region * 3;
    regionScissor[scissor] = faceX + x0 * SHADOW_PAGE;
    regionScissor[scissor + 1] = faceY + y0 * SHADOW_PAGE;
    regionScissor[scissor + 2] = (x1 - x0 + 1) * SHADOW_PAGE;
    regionScissor[scissor + 3] = (y1 - y0 + 1) * SHADOW_PAGE;
    regionViewport[viewport] = faceX;
    regionViewport[viewport + 1] = faceY;
    regionViewport[viewport + 2] = slices.rects[rect + 2];
    // Regions of the same face follow each other: a change of slice/face pair is one more redrawn
    // face, and that is what the profile publishes next to the pages.
    if (newFace) {
      lastSlice = slice;
      lastFace = face;
      lights.shadowFaces++;
      if (light.kind === 'directional') lights.sunCascades++;
      shadows.writeSliceInfo(
        slice,
        faceCountOf(LIGHT_KIND[light.kind]),
        Math.tan(planes.halfFov),
        side,
        planes.near,
      );
    }
  }
  runs.close(cam.eye, pixelError);
  if (count) shadows.flushRegions(count);
  writeDrawnMasks(lights);
  shadows.flushSlices();
  lights.shadowsUpdated = plan.counts.lights;
  lights.shadowRegions = count;
  lights.shadowPages = regions.pages;
  return count;
}

/**
 * Plans the image's shadow regions once. The CPU cut plans them before it writes its rows —
 * the light cuts' casters need rows too —, and the direct-lighting pass then reads the same plan.
 * An unlit view, or a scene without light, plans nothing and leaves no run behind.
 */
export function planImageShadows(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { lights, run } = rt,
    { store } = lights;
  if (!store.count || store.unlit) {
    lights.runs.reset();
    return 0;
  }
  if (lights.plannedFrame === run.frame) return lights.shadowRegions;
  lights.plannedFrame = run.frame;
  return planShadowRegions(rt, cam, run.frame, performance.now());
}
