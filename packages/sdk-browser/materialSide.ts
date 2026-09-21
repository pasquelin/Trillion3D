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
