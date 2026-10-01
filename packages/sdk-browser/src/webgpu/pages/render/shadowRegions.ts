import { followLightThreshold, followOcclusion } from '../prepare/lightResources.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { EngineCamera } from '../../../camera/world.ts';
import { writeShadowRecords } from '../../shadow/pages.ts';
import { createShadowStaticLayer, shadowLayerTexture } from '../../../gpu/shadow/staticLayer.ts';
import { deviceMade } from '../../../gpu/core/errorScope.ts';
import { shadowAtlasBytes } from '../../../gpu/shadow/atlas.ts';
import { createShadowPageHiz } from '../../../gpu/shadow/pageHiz.ts';
import { createShadowOcclusion } from '../../../gpu/shadow/occlusion.ts';
import { noteResidenceChange } from '../../shadow/bounds.ts';
import { redrawShortPages } from '../../shadow/casters.ts';
import { disposeStaticLayer } from '../state/lights.ts';
import { staticLayerGranted } from '../../shadow/poolSize.ts';
import { noteShadowPressure } from '../../shadow/memoryGrant.ts';

import { shadowViewpointOf } from './shadowViewpoint.ts';

/**
 * Plans this image's shadow pages — every stale one the image reads — and writes every light's
 * record; the pages themselves are composed batch by batch as they are encoded
 * (`encodeShadowBatches.ts`). Returns the pages to draw.
 */
export function planShadowRegions(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  frame: number,
  nowMs: number,
) {
  const { lights } = rt,
    { shadows, plan, store, runs, regions } = lights,
    { rows, recordOf, selectionRoots: roots } = rt.layout;
  runs.reset();
  regions.reset();
  lights.packedBatch.frame = -1;
  // Residency this frame's light cuts see changed since the last plan: those pages alone restale.
  let residencyMoved = false;
  const { residentFlags, residentOffsetWords } = rows;
  lights.residence.flush(residentFlags, residentOffsetWords, rt.run.gpuFrameActive, (page) => {
    residencyMoved = true;
    noteResidenceChange(lights, roots, rt.layout.placement.rootOfPacked, page, recordOf(page)!);
  });
  lights.shadowPages = 0;
  lights.shadowFaces = 0;
  lights.shadowWork.reset();
  lights.shadowDrawCalls = 0;
  lights.shadowRenderPasses = 0;
  // An atlas not sized yet holds no page: nothing to plan before the first frame on the canvas.
  if (!shadows?.view || !store.count) {
    plan.releaseDeferred();
    return 0;
  }
  // The light cuts measure their error at the camera's threshold, in the eye's render frame.
  lights.shadowPixelError = followLightThreshold(lights, rt.run.gate.pixelError, cam.eye);
  // Shadow detail is the display's, whatever size the frame is drawn at.
  const view = shadowViewpointOf(cam, rt.gpu.displaySize[1]);
  const box = lights.sceneBox(rt.layout, rt.run.gate.revisions.scene);
  ensureStaticLayer(rt);
  redrawShortPages(rt, frame, nowMs, residencyMoved);
  const count = plan.plan(store, view, box.min, box.max, frame, nowMs);
  lights.shadowSlots = writeShadowRecords(lights);
  lights.shadowsUpdated = plan.counts.lights;
  return count;
}

/**
 * The static layer is built the first time an object moves, with the pyramids of its pages and
 * the occlusion test of the moving casters; until they are ready, pages are drawn whole, every
 * caster at once. It is asked of the shadows' grant first (`staticLayerGranted`), its texture
 * made under an out-of-memory check (`deviceMade`): past the grant or refused, it is never made
 * and the pages stay drawn whole, by name (`../../shadow/memoryGrant.ts`).
 */
function ensureStaticLayer(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    device = rt.gpu.device;
  if (!lights.mobility.layered || lights.staticLayer || lights.staticLayerPending || !device)
    return;
  // The layer is the pool's size: it waits for the pool, which keeps its size from then on.
  if (!lights.shadows?.texture) return;
  lights.staticLayerPending = true;
  const capacity = rt.layout.rows.casterSlots,
    { side, layers } = lights.plan.pool;
  if (!staticLayerGranted(lights, rt.diag.engineDiagnostic)) return;
  deviceMade(device, () => shadowLayerTexture(device, side, layers))
    .then((texture) => {
      if (texture) return createShadowStaticLayer(device, texture);
      noteShadowPressure(lights.memory, 'static-layer-refused');
      rt.diag.engineDiagnostic('gpu-out-of-memory', 'The device refused the shadow static layer', {
        kind: 'warning',
        pool: 'shadow-static-layer',
        requestedBytes: shadowAtlasBytes(side, layers),
        grantedBytes: null,
      });
    })
    .then(async (layer) => {
      if (!layer) return;
      // A device that refuses the pyramids or the occlusion test keeps the layer, casters untested.
      try {
        lights.pageHiz = await createShadowPageHiz(device, layer.targets[0]);
        lights.occlusion = await createShadowOcclusion(device, capacity);
        followOcclusion(rt);
      } catch (error) {
        lights.pageHiz?.dispose();
        lights.pageHiz = undefined;
        rt.diag.diagnosticFailure('shadow-occlusion-unavailable', error);
      }
      lights.staticLayer = layer;
      // A session disposed meanwhile tore its layer down already: what landed after is freed.
      if (rt.signal.aborted) disposeStaticLayer(lights);
    })
    .catch((error) => rt.diag.diagnosticFailure('shadow-static-layer-unavailable', error));
}
