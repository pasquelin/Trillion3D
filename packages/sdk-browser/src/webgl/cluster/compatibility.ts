import { coatedScreenReflects } from '../../reflections/eligible.ts';
import { surfaceOf } from '../../page/surface.ts';
import type { BatchPage } from '../../cluster/batchRange.ts';
import { clusterMaterialReason } from '../../host/surfaceGate.ts';
import { isTransmissive } from '../../visibility/shader/material.ts';
import { unsupportedClusterLight, type WebglClusterScene } from './lights.ts';
import { backdropFormatReason } from './backdrop.ts';
export { clusterMaterialReason } from '../../host/surfaceGate.ts';

type SceneCopy = {
  material: BatchPage['declaration'];
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
  const lightReason = unsupportedClusterLight(scene.lights);
  if (lightReason) return lightReason;
  // Every scene copy is the owner's; only a transmissive one reads the frozen backdrop.
  const transmits = copies.some((copy) => isTransmissive(copy.material));
  // Only a screen-traced receiver needs the half-float capture; a matte one reads the environment.
  const mirrors =
    copies.some((copy) => coatedScreenReflects(surfaceOf(copy.material))) ||
    pages.some((page) => coatedScreenReflects(surfaceOf(page.declaration)));
  const formatReason =
    transmits || mirrors
      ? backdropFormatReason(gl, mirrors ? 'reflections' : 'transmission')
      : undefined;
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
    const reason = clusterMaterialReason(page.declaration, page.attributes);
    if (reason) return reason;
  }
}
