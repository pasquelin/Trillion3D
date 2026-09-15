import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import { createGpuLightTiles } from './gpuLightTiles.ts';
import { createGpuShadowAtlas, shadowAtlasBytes } from './gpuShadowAtlas.ts';
import { createGpuShadowCull } from './gpuShadowCull.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Ce que la capacité déclare quand le contrat d'éclairage direct n'est pas gréé sur cet appareil. */
const DIRECT_LIGHT_CAPABILITY = 'contract scene lights with shadow atlas';
/** Approximation nommée du chemin d'ombres, publiée dans le diagnostic (P5). */
const SHADOW_APPROXIMATIONS = [
  'alpha-masked occluders cast their whole cluster silhouette',
  'tile light lists bound the per-pixel loop to the published per-tile budget',
  'shadow slice priority uses an angular screen-coverage estimate, not an adjoint',
  'shadow cluster rejection uses the world sphere of a cluster, never its exact hull',
];

/**
 * Grée le contrat d'éclairage direct : listes de lampes par tuile et atlas d'ombres. Les deux sont
 * facultatifs — un appareil sans calcul, ou qui refuse l'atlas, garde une image correcte, les lampes
 * du contrat restent éteintes et la capacité manquante est déclarée. Rien n'est jeté en silence.
 */
export async function prepareDirectLights(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, vis, capabilities, diag } = rt,
    { drawSlots } = rt.layout;
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
  try {
    lights.shadows = await createGpuShadowAtlas(device, vis.visBindGroupLayout);
    lights.cull = await createGpuShadowCull(device, drawSlots);
  } catch (error) {
    lights.shadowReason = `shadow atlas unavailable: ${String(error)}`;
    diag.diagnosticFailure('shadow-atlas-unavailable', error);
  }
  if (lights.tiles && lights.shadows)
    capabilities.unsupported = capabilities.unsupported.filter(
      (item) => item !== DIRECT_LIGHT_CAPABILITY,
    );
  diag.engineDiagnostic('direct-lighting', 'Éclairage direct du contrat gréé', {
    version: 1,
    settings: { ...LIGHT_SETTINGS },
    tileLists: !!lights.tiles,
    shadowAtlas: lights.shadows ? lights.shadows.size : null,
    shadowCullRows: lights.cull ? drawSlots : null,
    shadowAtlasBytes: lights.shadows ? shadowAtlasBytes() : 0,
    unavailable: lights.shadowReason,
    approximations: SHADOW_APPROXIMATIONS,
  });
}
