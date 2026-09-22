/**
 * The surface record a page carries: everything the engine path reads of a material, in the
 * engine's own words, and nothing of the host object it was read from.
 *
 * Until this batch a page carried the host material declaration itself, and every reader on the
 * way to the image — the cut's normal cones, the row writer, the software raster, the coplanar
 * layer batches, the frame audit, the transparent items — reached back into it for a side, a
 * transparency flag, a colour. The record below is read ONCE per declaration, at the two
 * boundaries that own that read (`hostSurfaceImport.ts` for the shaded fields, `materialSide.ts`
 * for the raster ones); downstream no file of the engine path names a host material again.
 *
 * Its shaded fields are exactly the ones the cache's material table declares (#287,
 * `sceneTableContracts.ts`), and `checkPreparedScene` already proves the two equal field by field
 * at load. Filling the record FROM that table instead of from the host declaration is what
 * removing the loader asks for (#78, part 4c), and it waits on the texture images the loader
 * alone decodes today: a table slot names a glTF rank, and the loader folds several ranks into
 * one decoded record.
 *
 * A record is held BY its declaration and refilled IN PLACE, so every page of every placement of
 * one surface shares a single record and comparing two surfaces is comparing two references. The
 * host declaration itself stays reachable where a host boundary needs to hand it back to the
 * library that owns it — `PageRec.declaration` — and the closed list of
 * `test/integration/moteur-sans-three.test.ts` says who may read that field.
 */
import type { Side } from '../sdk-core/index.ts';
import type { HostMaterials } from './hostResources.ts';
import { firstMaterial, materialRaster, sideOf, type MaterialRaster } from './materialSide.ts';
import { visMaterial } from './visibilityMaterial.ts';
import type { VisMaterial } from './visibilityTypes.ts';

/** The shaded fields of a surface, and the raster facts declared beside them. */
export type PageSurface = VisMaterial & MaterialRaster;

/** The side a record declares, in the engine's own enum. */
export const surfaceSide = (surface: PageSurface): Side =>
  surface.doubleSided ? 'double' : surface.backSide ? 'back' : 'front';
/** True when only the front faces are drawn: the one case a normal cone may reject a page. */
export const surfaceFrontOnly = (surface: PageSurface) => !surface.doubleSided && !surface.backSide;

const held = new WeakMap<object, PageSurface>();
const declarations = new WeakMap<PageSurface, HostMaterials>();

/** Fills a record from a declaration, reusing the object so every holder sees the new fields. */
function fill(into: PageSurface, material: HostMaterials): PageSurface {
  return materialRaster(material, Object.assign(into, visMaterial(material)));
}

/**
 * The engine record of a host declaration, built at its first page and reread when the host
 * rewrites the declaration in place. Called at the boundaries that hold a host material — the
 * collection, a witness that repaints its pages — and nowhere else.
 */
export function surfaceOf(material: HostMaterials): PageSurface {
  const kept = held.get(material as object);
  if (kept) return refreshSurface(kept);
  const surface = fill({} as PageSurface, material);
  held.set(material as object, surface);
  declarations.set(surface, material);
  return surface;
}

/** The record of a drawn mesh's declaration: the collection's only door to a host material. */
export const meshSurface = (mesh: { material: HostMaterials }) => surfaceOf(mesh.material);

/**
 * Rereads a record whose declaration the host has rewritten, and returns it either way; a record
 * built outside this module — a fixture's — is returned untouched.
 *
 * The raster facts are reread on every call: a host writes `side`, `alphaTest` or `opacity` on
 * the declaration it shares with its mesh without bumping any version, and the transparent plan
 * (`webgpuBlendPlan.ts`) and the software raster (`visibilityRaster.ts`) have to see it between
 * two images. The shaded fields, which walk the six map slots, are reread only when the version
 * moved — the comparison the page row already made before writing.
 */
export function refreshSurface(surface: PageSurface): PageSurface {
  const material = declarations.get(surface);
  if (!material) return surface;
  if ((firstMaterial(material)?.version ?? 0) !== surface.version) return fill(surface, material);
  const side = sideOf(material);
  surface.doubleSided = side === 'double';
  surface.backSide = side === 'back';
  return materialRaster(material, surface);
}
