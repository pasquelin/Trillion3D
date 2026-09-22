import type { Side } from '../sdk-core/index.ts';
import type { HostMaterial, HostMaterials } from './hostResources.ts';

/** The host face constants, in the order glTF and every rendering library built on it number
 *  them: front, back, then both. Read here once and nowhere else — the raster, the cones, the
 *  pipelines and the blend plan compare against `Side`. */
const HOST_SIDE_FRONT = 0,
  HOST_SIDE_BACK = 1,
  HOST_SIDE_DOUBLE = 2;

/** The material that decides for a mesh: the one declared, or the first of an array — an
 *  empty array declaring nothing (`undefined`). */
export const firstMaterial = (material: HostMaterials): HostMaterial | undefined =>
  Array.isArray(material) ? material[0] : material;

/** The host side constant a material declares, the first of an array deciding; an empty
 *  array declares nothing and gets the host default, front, instead of a crash. */
export function materialSide(material: HostMaterials): number {
  return firstMaterial(material)?.side ?? HOST_SIDE_FRONT;
}

/** The side a host material declares, read once at the boundary into the engine's own enum. */
export function sideOf(material: HostMaterials): Side {
  const side = materialSide(material);
  return side === HOST_SIDE_DOUBLE ? 'double' : side === HOST_SIDE_BACK ? 'back' : 'front';
}

/**
 * The raster facts a host declares beside the shaded ones: which version of the declaration this
 * is, its opacity, whether it is drawn blended, whether the host draws a double-sided blended
 * surface in one pass, and whether it is one material per geometry group. The cache's material table declares
 * none of them (`sceneTableContracts.ts`), so they are read here, at the same boundary as the
 * side, and travel on inside the engine's own surface record (`pageSurface.ts`).
 */
export function materialRaster(material: HostMaterials) {
  const first = firstMaterial(material);
  return {
    version: first?.version ?? 0,
    opacity: first?.opacity ?? 1,
    transparent: Array.isArray(material)
      ? material.some((entry) => entry.transparent)
      : !!material?.transparent,
    forceSinglePass: !!first?.forceSinglePass,
    grouped: Array.isArray(material) && material.length > 1,
  };
}
