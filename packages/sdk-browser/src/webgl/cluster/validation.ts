import type { ClusterDrawMesh, HostAttributes, WholeMesh } from '../../cluster/batchMesh.ts';
import { attributeNeeds, attributesLack, surfaceReasons } from '../../host/surfaceGate.ts';
import { refuseCluster as refuse } from './refusal.ts';
import type { Material } from './materialBinding.ts';
import { physicalFeaturesLost } from '../../scene/physicalMaterialGate.ts';

/** Hears the physical `features` a surface is drawn without on WebGL2 (`physicalFeaturesLost`):
 *  the hearer says each once (`noticeMaterialDegraded`). */
export type MaterialDegraded = (material: Material, features: readonly string[]) => void;

/** What reads a drawn surface's lost physical features (`readDegraded`). */
export type ReadDegraded = (material: Material) => void;

/** Reads a drawn surface's lost features for `hear` once per version of the surface: a frame
 *  that draws it unchanged scans nothing. */
export function readDegraded(hear: MaterialDegraded): ReadDegraded {
  const read = new WeakMap<Material, number>();
  return (material: Material) => {
    if (read.get(material) === material.version) return;
    read.set(material, material.version);
    const lost = physicalFeaturesLost(material);
    if (lost) hear(material, lost);
  };
}

/** A surface's own part of the gate, read once a frame: its reasons, and what its pages'
 *  attributes must hold. */
type SurfaceRead = {
  before: string | undefined;
  after: string | undefined;
  needs: ReturnType<typeof attributeNeeds>;
};

type Copies = {
  plain: readonly WholeMesh[];
  blended: readonly WholeMesh[];
  transmissive: readonly WholeMesh[];
};

/**
 * Refuses every mesh of a frame before any of them is submitted: no partial image. Only the
 * copies of the transmission pass may transmit; a page or a plain copy that does is refused. A
 * physical extension is no refusal: the surface is drawn without it and `degraded` reads it.
 *
 * A renderer holds one, and its tables are the frame's: `seen`, the attributes each surface was
 * last validated with, and `surfaces`, a surface's own reasons by pass (`surfaceReasons`) and what
 * its pages' attributes need (`attributeNeeds`) — a frame drawing many pages of one surface reads
 * it once, their attributes per page (#840: sponza read the
 * whole gate for 1 465 pages a frame). Both are cleared at every frame: a mutation is read at the
 * next draw.
 */
export class ClusterMeshValidation {
  private seen = new Map<Material, HostAttributes>();
  private surfaces = [new Map<Material, SurfaceRead>(), new Map<Material, SurfaceRead>()];
  validate(
    meshes: readonly ClusterDrawMesh[],
    wholeMeshes: readonly WholeMesh[],
    copies: Copies,
    degraded?: ReadDegraded,
  ) {
    this.seen.clear();
    for (const read of this.surfaces) read.clear();
    this.meshes(meshes, false, degraded);
    this.meshes(wholeMeshes, false, degraded);
    this.meshes(copies.plain, false, degraded);
    this.meshes(copies.blended, false, degraded);
    this.meshes(copies.transmissive, true, degraded);
  }
  private meshes(
    meshes: readonly (ClusterDrawMesh | WholeMesh)[],
    transmissive: boolean,
    degraded: ReadDegraded | undefined,
  ) {
    const seen = this.seen;
    for (const mesh of meshes) {
      const { material } = mesh,
        attributes = mesh.geometry.attributes;
      if (Array.isArray(material)) refuse('material arrays are unsupported');
      const previous = seen.get(material);
      if (previous === attributes) continue;
      const reason = this.reason(material, attributes, transmissive);
      if (reason) refuse(reason);
      if (previous) continue;
      seen.set(material, attributes);
      degraded?.(material);
    }
  }
  /** The gate's reason for one mesh (`clusterMaterialReason`), its surface's part read once. */
  private reason(material: Material, attributes: HostAttributes, transmissive: boolean) {
    const read = this.surfaces[transmissive ? 1 : 0];
    let surface = read.get(material);
    if (!surface) {
      const [before, after] = surfaceReasons(material, transmissive);
      read.set(material, (surface = { before, after, needs: attributeNeeds(material) }));
    }
    return surface.before ?? attributesLack(surface.needs, attributes) ?? surface.after;
  }
}
