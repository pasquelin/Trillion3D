import { LIGHT_SETTINGS } from '../../../../../sdk-core/src/index.ts';
import { createGpuLightTiles } from '../../../lighting/tiles/tiles.ts';
import { createGpuShadowAtlas } from '../../../gpu/shadow/atlas.ts';
import { createGpuShadowCull } from '../../../gpu/shadow/cull.ts';
import { createShadowMovingGroups } from '../../shadow/movingGroups.ts';
import { createShadowPageQuads } from '../../../gpu/shadow/pageQuads.ts';
import { grantCapability } from '../io/drops.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { isCancelled } from '../../../backend/common.ts';
import { createHizPipelines } from '../../../gpu/hiz/pipelines.ts';
import { shadowOcclusionPipeline } from '../../../gpu/shadow/occlusion.ts';
import { sceneCastsBlended } from '../../shadow/transmittanceGrant.ts';
import { lightRowMapPipeline } from '../../../gpu/draw/lightRows.ts';
import { createShadowDemand } from '../../shadow/demandPass.ts';
import { createShadowAllocation } from '../../shadow/allocPass.ts';

/** What the capability declares when the direct-lighting contract is not fitted on this device. */
const DIRECT_LIGHT_CAPABILITY = 'contract scene lights with shadow atlas';
/** Named approximation of the shadow path, published in the diagnostic (P5). */
const SHADOW_APPROXIMATIONS = [
  'a blended cluster casts from a shadow-only row into the transmittance layer, at half the pool resolution and filtered by the same PCF: one 8-bit product of (1 − coverage) and one nearest 32-bit depth per texel, so a receiver between two stacked panes takes both; additive and transmissive surfaces cast nothing until tinted transmission shadows (#33), and an unpaged blended mesh casts nothing',
  'shadow cluster rejection uses the world sphere of a cluster, never its exact hull',
  'shadow pages are asked for by the opaque surfaces alone, per pixel before any page is drawn and again by the resolve: a transparent or water surface reads the pages the opaque pixels asked for, and falls back to a coarser level where none did',
  'a shadow page asked for is mapped and drawn on the GPU in the frame that asks for it, with every resident caster row its own light-space volume touches, blended casters into the transmittance layer too; the host draws it again with its light cut and static layer once its request report comes back, a frame or two later; a frame draws no more of them than its pair list holds every caster row of, the rest wait for the next frame, the pixel reading the next coarser level meanwhile',
];

/**
 * Fits the direct-lighting contract: per-tile light lists and the shadow atlas. Both are optional —
 * a device without compute, or that refuses the atlas, keeps a correct image, the contract lights
 * stay off and the missing capability is declared. Nothing is dropped in silence.
 */
export async function prepareDirectLights(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, vis, capabilities, diag } = rt,
    { casterSlots } = rt.layout.rows;
  if (rt.context.shadowPageInvalidation === false) lights.plan.setPageInvalidation(false);
  if (!lights.buffer || !vis.visEnabled || !vis.visBindGroupLayout) {
    lights.shadowReason = 'visibility buffer unavailable';
    return;
  }
  try {
    lights.tiles = await createGpuLightTiles(device);
  } catch (error) {
    if (isCancelled(rt.signal)) throw error;
    lights.shadowReason = `light tiles unavailable: ${String(error)}`;
    diag.diagnosticFailure('light-tiles-unavailable', error);
    return;
  }
  // The atlas, per-face cull and page quads go together: the shadow pass draws from the list cull
  // produces, from pages the quads clear. One without the others would light nothing, so the
  // failure of one yields all.
  try {
    lights.shadows = await createGpuShadowAtlas(
      device,
      vis.visBindGroupLayout,
      lights.plan.table.entries,
    );
    lights.cull = await createGpuShadowCull(device, casterSlots);
    lights.pageQuads = await createShadowPageQuads(device, lights.shadows.faceUniform);
  } catch (error) {
    if (isCancelled(rt.signal)) throw error;
    lights.shadows?.dispose();
    lights.cull?.dispose();
    lights.pageRequests?.dispose();
    lights.shadows = undefined;
    lights.cull = undefined;
    lights.pageRequests = undefined;
    lights.shadowReason = `shadow atlas unavailable: ${String(error)}`;
    diag.diagnosticFailure('shadow-atlas-unavailable', error);
  }
  // Without the moving groups, every restored page draws its moving casters alone.
  if (lights.cull)
    lights.movingGroups = await createShadowMovingGroups(device).catch((error) => {
      if (isCancelled(rt.signal)) throw error;
      diag.diagnosticFailure('shadow-moving-groups-unavailable', error);
      return undefined;
    });
  // Without the per-pixel demand the resolve's own requests still name every page it reads.
  if (lights.shadows)
    lights.demand = await createShadowDemand(device, lights.plan.sunWindow).catch((error) => {
      if (isCancelled(rt.signal)) throw error;
      diag.diagnosticFailure('shadow-demand-unavailable', error);
      return undefined;
    });
  // The GPU maps what the demand marks; without either, the reports map the pages on the host.
  if (lights.demand)
    lights.allocation = await createShadowAllocation(device, lights.plan.sunWindow).catch(
      (error) => {
        if (isCancelled(rt.signal)) throw error;
        diag.diagnosticFailure('shadow-allocation-unavailable', error);
        return undefined;
      },
    );
  if (lights.tiles && lights.shadows) grantCapability(capabilities, DIRECT_LIGHT_CAPABILITY);
  diag.engineDiagnostic('direct-lighting', 'Direct lighting of the contract, fitted', {
    version: 1,
    settings: { ...LIGHT_SETTINGS },
    tileLists: !!lights.tiles,
    // The atlas is sized at the first frame (`../../shadow/poolSize.ts`, diagnostic `shadow-pool`).
    shadowAtlas: !!lights.shadows,
    shadowCullRows: lights.cull ? casterSlots : null,
    shadowPageInvalidation: lights.plan.pageInvalidation,
    unavailable: lights.shadowReason,
    approximations: SHADOW_APPROXIMATIONS,
  });
}

/**
 * Every pipeline the shadow pass may need after prepare, compiled now — its own preparation step,
 * cold work said apart from every frame (#989): the pool's three caster draws (#965), the light
 * cut's row map, the page pyramids and the occlusion test the static layer needs from an object's
 * first move — the pyramids' kernels are the camera's Hi-Z's —, and, for a scene whose blended
 * surfaces cast, the transmittance layer's draws. A frame then compiles none. One that fails here
 * is compiled again, and said, where it is first used.
 */
export async function prepareShadowPipelines(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { shadows, pageQuads } = rt.lights;
  if (!shadows || !pageQuads) return;
  // The Hi-Z kernels alone first: their validation scope stays open across an await, and a
  // pipeline made meanwhile would lay its error there. The rest opens no scope: compiled together.
  await createHizPipelines(device).catch(() => undefined);
  const work: Array<() => unknown> = [shadows.prepareDepth, () => shadowOcclusionPipeline(device)];
  if (rt.lights.movingGroups) work.push(shadows.groupDraws.prepare);
  // The pages the GPU draws itself (#1275): its pool's draws, and its layer's with the host's.
  if (rt.lights.allocation) work.push(shadows.freshDraws.prepare);
  if (rt.vis.gpuDraw) work.push(() => lightRowMapPipeline(device));
  if (sceneCastsBlended(rt))
    work.push(shadows.prepareTransmittance, pageQuads.prepareTransmittance);
  // One that fails is compiled again, and said, where it is first used.
  await Promise.allSettled(work.map(async (make) => make()));
}
