import type { ClusterDrawMesh, HostAttributes, WholeMesh } from '../../cluster/batchMesh.ts';
import { attributeNeeds, attributesLack, surfaceReasons } from '../../host/surfaceGate.ts';
import type { Material } from './materialBinding.ts';
import { featuresOf, physicalLostMask } from '../../scene/physicalMaterialGate.ts';

/** Hears the physical `features` a surface is drawn without on WebGL2 (`physicalLostMask`),
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

/** A surface's own part of the gate, read once a frame: its reasons, and what its pages'
 *  attributes must hold. */
type SurfaceRead = {
  before: string | undefined;
  after: string | undefined;
  needs: ReturnType<typeof attributeNeeds>;
};

/** The gate's reason for one mesh (`clusterMaterialReason`), its surface's part read once a
 *  frame into `read` (#840: sponza read the whole gate for 1 465 pages a frame). */
const reasonOf = (
  read: Map<Material, SurfaceRead>,
  material: Material,
  attributes: HostAttributes,
  transmissive: boolean,
) => {
  let surface = read.get(material);
  if (!surface) {
    const [before, after] = surfaceReasons(material, transmissive);
    read.set(material, (surface = { before, after, needs: attributeNeeds(material) }));
  }
  return surface.before ?? attributesLack(surface.needs, attributes) ?? surface.after;
};

type Tables = {
  seen: Map<Material, HostAttributes>;
  surfaces: readonly Map<Material, SurfaceRead>[];
  left: Set<Drawn>;
};

const validateMeshes = (
  meshes: readonly Drawn[],
  { seen, surfaces, left }: Tables,
  transmissive: boolean,
  degraded: ReadDegraded,
) => {
  for (const mesh of meshes) {
    const material = mesh.material as Material,
      attributes = mesh.geometry.attributes;
    const previous = seen.get(material);
    if (previous === attributes) continue;
    const reason = reasonOf(surfaces[transmissive ? 1 : 0], material, attributes, transmissive);
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
 *
 * Its tables are the frame's, cleared at every frame so a mutation is read at the next draw:
 * `seen`, the attributes each surface was last validated with, and `surfaces`, a surface's own
 * reasons by pass and what its pages' attributes need — a frame drawing many pages of one surface
 * reads it once, their attributes per page.
 */
export function clusterValidation(degraded: ReadDegraded) {
  const tables: Tables = {
    seen: new Map(),
    surfaces: [new Map(), new Map()],
    left: new Set(),
  };
  return {
    validate(meshes: readonly ClusterDrawMesh[], whole: readonly WholeMesh[], copies: Copies) {
      tables.seen.clear();
      tables.left.clear();
      for (const read of tables.surfaces) read.clear();
      validateMeshes(meshes, tables, false, degraded);
      validateMeshes(whole, tables, false, degraded);
      validateMeshes(copies.plain, tables, false, degraded);
      validateMeshes(copies.blended, tables, false, degraded);
      validateMeshes(copies.transmissive, tables, true, degraded);
    },
    /** Whether this frame leaves `mesh` out. */
    leaves: (mesh: Drawn) => tables.left.has(mesh),
  };
}
