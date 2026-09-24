import type { Side } from '../../../sdk-core/src/index.ts';
import type { HostMaterial, HostMaterials } from '../host/resources.ts';

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
/** A surface as far as its faces go: what a diagnostic copy, of the engine or of a witness,
 *  shares with the engine's own. */
type Sided = { readonly side: number };

export function materialSide(material: Sided | readonly Sided[]): number {
  const first = 'length' in material ? material[0] : material;
  return first?.side ?? HOST_SIDE_FRONT;
}

/** The side a host material declares, read once at the boundary into the engine's own enum. */
export function sideOf(material: HostMaterials): Side {
  const side = materialSide(material);
  return side === HOST_SIDE_DOUBLE ? 'double' : side === HOST_SIDE_BACK ? 'back' : 'front';
}

/** The host face constant for the side the engine declares: the way back, for a boundary that
 *  builds a host material out of the engine's own material parameters. */
export const hostSide = (side: Side): number =>
  side === 'double' ? HOST_SIDE_DOUBLE : side === 'back' ? HOST_SIDE_BACK : HOST_SIDE_FRONT;

/**
 * The raster facts a host declares beside the shaded ones: which version of the declaration this
 * is, its opacity, its alpha cutoff, whether it is drawn blended, whether the host draws a
 * double-sided blended surface in one pass, and whether it is declared as one material per
 * geometry group. The host declaration they are read from is built from the cache's material
 * table (`../host/prepared/materials.ts`); they are read here, at the same boundary as the side, and travel on inside the engine's own surface record (`../page/surface.ts`).
 * They are written INTO the record given: this runs per page row and per plan entry.
 */
export type MaterialRaster = {
  version: number;
  opacity: number;
  alphaTest: number;
  transparent: boolean;
  forceSinglePass: boolean;
  grouped: boolean;
};
export function materialRaster<T extends MaterialRaster>(material: HostMaterials, into: T): T {
  const first = firstMaterial(material);
  into.version = first?.version ?? 0;
  into.opacity = first?.opacity ?? 1;
  into.alphaTest = first?.alphaTest ?? 0;
  into.transparent = Array.isArray(material)
    ? material.some((entry) => entry.transparent)
    : !!material?.transparent;
  into.forceSinglePass = !!first?.forceSinglePass;
  into.grouped = Array.isArray(material);
  return into;
}
