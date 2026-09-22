import type { BatchPage } from './clusterBatches.ts';
import { clusterMaterialReason } from './hostSurfaceGate.ts';
import { isTransmissive } from './visibilityMaterial.ts';
import { unsupportedClusterLight, type WebglClusterScene } from './webglClusterLights.ts';
import { backdropFormatReason } from './webglClusterBackdrop.ts';
export { clusterMaterialReason } from './hostSurfaceGate.ts';

type SceneCopy = {
  material: BatchPage['material'];
  geometry: { attributes: BatchPage['attributes'] };
};

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
  // Every scene copy is the owner's; only a transmissive one reads the frozen backdrop.
  const transmits = copies.some((copy) => isTransmissive(copy.material));
  const formatReason = transmits ? backdropFormatReason(gl) : undefined;
  if (formatReason) return formatReason;
  for (const copy of copies) {
    const reason = clusterMaterialReason(
      copy.material,
      copy.geometry.attributes,
      isTransmissive(copy.material),
    );
    if (reason) return reason;
  }
  for (const page of pages) {
    const reason = clusterMaterialReason(page.material, page.attributes);
    if (reason) return reason;
  }
}
