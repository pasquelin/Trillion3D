import type { ClusterDrawMesh, HostAttributes, WholeMesh } from '../../cluster/batchMesh.ts';
import { clusterMaterialReason } from './compatibility.ts';
import type { Material } from './materialBinding.ts';
import { featuresOf, physicalLostMask } from '../../scene/physicalMaterialGate.ts';

/** Hears the physical `features` a surface is drawn without on WebGL2 (`physicalFeaturesLost`),
 *  or, with `leftOut`, why the surface is not drawn at all: the hearer says each once
 *  (`noticeMaterialDegraded`). */
export type MaterialDegraded = (
  material: Material,
  features: readonly string[],
  leftOut?: string,
) => void;

/** What reads a drawn surface's lost physical features, or hears why it is left out. */
export type ReadDegraded = (material: Material, leftOut?: string) => void;

/** Reads a drawn surface's lost features for `hear` on each draw, by their mask: a frame that
 *  draws it unchanged allocates nothing and says nothing, and a field set on a live surface
 *  without `needsUpdate` is read all the same. A surface left out is handed on with its reason. */
export function readDegraded(hear: MaterialDegraded): ReadDegraded {
  const read = new WeakMap<Material, number>();
  return (material: Material, leftOut?: string) => {
    if (leftOut) return hear(material, [], leftOut);
    const mask = physicalLostMask(material);
    if (read.get(material) === mask) return;
    read.set(material, mask);
    if (mask) hear(material, featuresOf(mask));
  };
}

type Drawn = ClusterDrawMesh | WholeMesh;

const validateMeshes = (
  meshes: readonly Drawn[],
  seen: Map<Material, HostAttributes>,
  left: Set<Drawn>,
  transmissive: boolean,
  degraded: ReadDegraded,
) => {
  for (const mesh of meshes) {
    const material = mesh.material as Material,
      attributes = mesh.geometry.attributes;
    const previous = seen.get(material);
    if (previous === attributes) continue;
    const reason = clusterMaterialReason(material, attributes, transmissive);
    if (reason) {
      left.add(mesh);
      degraded(material, reason);
      continue;
    }
    if (previous) continue;
    seen.set(material, attributes);
    degraded(material);
  }
};

/** The copies a frame draws, by the pass that draws them (`copyCulling.ts`). */
type Copies = {
  plain: readonly WholeMesh[];
  blended: readonly WholeMesh[];
  transmissive: readonly WholeMesh[];
};

/**
 * Reads every mesh of a frame before any of them is submitted (`validate`). A mesh whose surface
 * the gate refuses (`clusterMaterialReason`) is left out (`leaves`, which the draw asks), and
 * `degraded` hears why by name: every other mesh draws and the loop goes on. Only the copies of
 * the transmission pass may transmit; a page or a plain copy that does is left out. A physical
 * extension is no refusal: the surface is drawn without it and `degraded` reads it.
 */
export function clusterValidation(degraded: ReadDegraded) {
  const seen = new Map<Material, HostAttributes>(),
    left = new Set<Drawn>();
  return {
    validate(meshes: readonly ClusterDrawMesh[], whole: readonly WholeMesh[], copies: Copies) {
      seen.clear();
      left.clear();
      validateMeshes(meshes, seen, left, false, degraded);
      validateMeshes(whole, seen, left, false, degraded);
      validateMeshes(copies.plain, seen, left, false, degraded);
      validateMeshes(copies.blended, seen, left, false, degraded);
      validateMeshes(copies.transmissive, seen, left, true, degraded);
    },
    /** Whether this frame leaves `mesh` out. */
    leaves: (mesh: Drawn) => left.has(mesh),
  };
}
