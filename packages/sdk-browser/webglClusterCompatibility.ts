import type { BatchPage } from './clusterBatches.ts';
import { clusterMaterialReason, isTransmissive } from './visibilityMaterial.ts';
import { unsupportedClusterLight, type WebglClusterScene } from './webglClusterLights.ts';
import { backdropFormatReason } from './webglClusterBackdrop.ts';
export { clusterMaterialReason } from './visibilityMaterial.ts';

type SceneCopy = {
  material: BatchPage['material'];
  geometry: { attributes: BatchPage['attributes'] };
};

/** Whether the owner draws a scene copy itself: a transmissive one reads the frozen backdrop. */
export const ownedSceneCopy = (copy: { material: BatchPage['material'] }) =>
  isTransmissive(copy.material);

/**
 * Names what keeps a scene off the autonomous path before anything is drawn. There is no other
 * renderer to fall back on: the reason becomes the backend's refusal, never a partial image.
 */
export function clusterWebglCompatibility(
  gl: WebGL2RenderingContext,
  pages: readonly BatchPage[],
  copies: readonly SceneCopy[],
  scene: WebglClusterScene,
) {
  const lightReason = unsupportedClusterLight(scene);
  if (lightReason) return lightReason;
  const owned = copies.filter(ownedSceneCopy);
  const formatReason = owned.length ? backdropFormatReason(gl) : undefined;
  if (formatReason) return formatReason;
  for (const copy of owned) {
    const reason = clusterMaterialReason(copy.material, copy.geometry.attributes, true);
    if (reason) return reason;
  }
  for (const page of pages) {
    const reason = clusterMaterialReason(page.material, page.attributes);
    if (reason) return reason;
  }
}
