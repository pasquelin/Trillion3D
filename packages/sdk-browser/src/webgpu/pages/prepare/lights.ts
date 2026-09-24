import { LIGHT_SETTINGS } from '../../../../../sdk-core/src/index.ts';
import { createGpuLightTiles } from '../../../lighting/tiles/tiles.ts';
import { createGpuShadowAtlas } from '../../../gpu/shadow/atlas.ts';
import { createGpuShadowCull } from '../../../gpu/shadow/cull.ts';
import { createShadowPageRequests } from '../../shadow/pageRequests.ts';
import { grantCapability } from '../io/drops.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** What the capability declares when the direct-lighting contract is not fitted on this device. */
const DIRECT_LIGHT_CAPABILITY = 'contract scene lights with shadow atlas';
/** Named approximation of the shadow path, published in the diagnostic (P5). */
const SHADOW_APPROXIMATIONS = [
  'blended clusters hold no visibility row, so they reach no shadow draw table and cast no shadow; only the opaque path casts a real cutout, and an attenuated tinted shadow is a later lot',
  'tile light lists bound the per-pixel loop of the opaque path to the published per-tile budget; the blend pass loops over the declared lights instead, bounded by maxLights',
  'shadow cluster rejection uses the world sphere of a cluster, never its exact hull',
  'the shadow millisecond budget folds a page fixed cost into an averaged per-page cost',
  'shadow pages are asked for by the opaque resolve alone: a transparent or water surface reads the pages the opaque pixels asked for, and falls back to a coarser level where none did',
  'a shadow page asked for is allocated when its request report comes back, a frame or two later: meanwhile the pixel reads the next coarser level',
];

/**
 * Fits the direct-lighting contract: per-tile light lists and the shadow atlas. Both are optional —
 * a device without compute, or that refuses the atlas, keeps a correct image, the contract lights
 * stay off and the missing capability is declared. Nothing is dropped in silence.
 */
export async function prepareDirectLights(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, vis, capabilities, diag } = rt,
    { drawSlots } = rt.layout;
  if (rt.context.shadowBudgetMs !== undefined) lights.plan.setBudgetMs(rt.context.shadowBudgetMs);
  if (rt.context.shadowPageInvalidation === false) lights.plan.setPageInvalidation(false);
  if (!lights.buffer || !vis.visEnabled || !vis.visBindGroupLayout) {
    lights.shadowReason = 'visibility buffer unavailable';
    return;
  }
  try {
    lights.tiles = await createGpuLightTiles(device, lights.buffer);
  } catch (error) {
    lights.shadowReason = `light tiles unavailable: ${String(error)}`;
    diag.diagnosticFailure('light-tiles-unavailable', error);
    return;
  }
  // The atlas and per-face cull go together: the shadow pass draws from the list cull produces.
  // One without the other would light nothing, so failure of one yields both.
  try {
    lights.shadows = await createGpuShadowAtlas(device, vis.visBindGroupLayout);
    lights.cull = await createGpuShadowCull(device, drawSlots);
    lights.pageRequests = createShadowPageRequests(device, lights.shadows.requestBuffer);
  } catch (error) {
    lights.shadows?.dispose();
    lights.cull?.dispose();
    lights.pageRequests?.dispose();
    lights.shadows = undefined;
    lights.cull = undefined;
    lights.pageRequests = undefined;
    lights.shadowReason = `shadow atlas unavailable: ${String(error)}`;
    diag.diagnosticFailure('shadow-atlas-unavailable', error);
  }
  if (lights.tiles && lights.shadows) grantCapability(capabilities, DIRECT_LIGHT_CAPABILITY);
  diag.engineDiagnostic('direct-lighting', 'Direct lighting of the contract, fitted', {
    version: 1,
    settings: { ...LIGHT_SETTINGS },
    tileLists: !!lights.tiles,
    // The atlas is sized at the first frame (`../../shadow/poolSize.ts`, diagnostic `shadow-pool`).
    shadowAtlas: !!lights.shadows,
    shadowCullRows: lights.cull ? drawSlots : null,
    shadowBudgetMs: lights.plan.budget.budgetMs,
    shadowPageInvalidation: lights.plan.pageInvalidation,
    unavailable: lights.shadowReason,
    approximations: SHADOW_APPROXIMATIONS,
  });
}
