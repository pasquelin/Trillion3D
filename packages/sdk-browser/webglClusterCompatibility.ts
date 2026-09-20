import type { BatchPage } from './clusterBatches.ts';
import { clusterMaterialReason, isTransmissive } from './visibilityMaterial.ts';
import { unsupportedClusterLight, type WebglClusterScene } from './webglClusterLights.ts';
export { clusterMaterialReason } from './visibilityMaterial.ts';

/** Refuses the whole autonomous path before drawing; the existing renderer stays pixel-complete. */
export function clusterWebglCompatibility(
  pages: readonly BatchPage[],
  blendCopies: Array<{ material: BatchPage['material'] }>,
  scene: WebglClusterScene,
) {
  const lightReason = unsupportedClusterLight(scene);
  if (lightReason) return lightReason;
  for (const copy of blendCopies)
    if (isTransmissive(copy.material))
      return 'forward transmission needs the complete opaque scene';
  for (const page of pages) {
    const reason = clusterMaterialReason(page.material, page.attributes);
    if (reason) return reason;
  }
}
