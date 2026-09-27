import type { Material } from '../../../../sdk-core/src/index.ts';
import type { HostMaterial, HostMaterials } from '../../host/resources.ts';
import {
  copyHostGeometry,
  hostPageBytes,
  hostPageSurface,
  releaseHostSurface,
  setHostSurface,
  colouredTwin,
} from '../../host/pageObjects.ts';
import { surfaceOf } from '../../page/surface.ts';
import type { PageRec, ClusterRoot } from '../../page/selection/selection.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import { composedPose, deplaceInstance } from './instancePose.ts';
import { attachedPages, drawnInstanced } from '../../placement/autonomousPlacements.ts';
import type { HeldFloor } from './heldFloor.ts';
import type { collectClusterPages } from '../../page/selection/collect.ts';
import { blendMoves, type AlphaChange } from '../../placement/backendSceneUpdates.ts';

type InstanceEnvironment = {
  roots: ClusterRoot<PageRec>[];
  baseRoots: ClusterRoot<PageRec>[];
  allPages: PageRec[];
  basePages: PageRec[];
  bootstrap: PageRec[];
  baseBootstrap: PageRec[];
  byUrl: Map<string, PageRec[]>;
  baseMaterials: Map<PageRec, HostMaterials>;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  /** The host's page ceiling, `Infinity` when it set none: the root cover an instance grows
   *  past it is refused by name. */
  hostCeiling: number;
  /** The host page ceiling's one rule (`heldFloor.ts`). */
  overCeiling: HeldFloor['overCeiling'];
  /** Notified by every entry point that writes the scene: that is where the origin is. */
  sceneChanged: () => void;
  /** Notified when an instance adds or removes the copies of its root cover. */
  coverChanged: () => void;
  /** The open's blended-or-not rule for a record once a material moved (`collectClusterPages`). */
  blendOf: ReturnType<typeof collectClusterPages>['blendOf'];
};

export function createAutonomousInstances(env: InstanceEnvironment) {
  const {
    roots,
    baseRoots,
    allPages,
    basePages,
    bootstrap,
    baseBootstrap,
    byUrl,
    baseMaterials,
    geometryStore,
    hostCeiling,
    overCeiling,
    blendOf,
    sceneChanged,
    coverChanged,
  } = env;
  // `pages[i]` is the clone of `bases[i]`: the pair is set at creation, not rebuilt as a
  // hash table on every instance move.
  const instances = new Map<
    string,
    { roots: ClusterRoot<PageRec>[]; pages: PageRec[]; bases: PageRec[]; bootstrap: PageRec[] }
  >();
  const { removeRecords, sync, colorMaterials } = geometryStore;
  /** The material this engine built from the contract for a primitive, and therefore frees
   *  itself: one entry per repainted primitive, replaced — not stacked — by the next paint. */
  const owned = new Map<string, HostMaterial>();
  /** Frees a paint and the twin the shared cache holds for it: repainting n times keeps one. */
  const releasePaint = (painted: HostMaterial) => {
    const twin = colorMaterials.get(painted);
    if (twin) {
      colorMaterials.delete(painted);
      releaseHostSurface(twin);
    }
    releaseHostSurface(painted);
  };
  return {
    /**
     * Why a material moved into or out of blended would take the cover past the host ceiling,
     * before any write (#846): records placed by rows are one instanced mesh while opaque, one mesh
     * a row once blended. The cover is counted as the open counts it, with the flags the move gives.
     */
    materialClassRefusal(alpha: AlphaChange) {
      const instanced = (rec: PageRec) => drawnInstanced(rec, blendOf(rec, alpha));
      if (blendMoves(alpha) && overCeiling(0, attachedPages(bootstrap, instanced)))
        return 'AUTONOMOUS_ROOT_BUDGET: the cover would hang more meshes than the host allows';
    },
    /** Classic instances held: each holds its own copy of every page geometry. */
    instanceCount: () => instances.size,
    disposeOwnedMaterials() {
      for (const painted of owned.values()) releasePaint(painted);
      owned.clear();
    },
    addInstance(id: string, transform: Float64Array) {
      sceneChanged();
      if (instances.has(id) || !id) throw new Error('AUTONOMOUS_INSTANCE_ID');
      // Without a host ceiling the cover is always drawn: nothing is counted.
      if (hostCeiling < Infinity) {
        // The meshes it adds to the cover: one per record drawn on its own. Its rowed records join
        // the model's own instanced meshes (`attachedPages`), which the cover already counts.
        // Counted now, not at the first instance: a class change moves records between the two
        // (`../../page/selection/collect.ts`, #846); a walk of the cover an instance copies anyway.
        const ownMeshes = baseBootstrap.filter((rec) => !drawnInstanced(rec)).length;
        if (overCeiling(ownMeshes)) throw new Error('AUTONOMOUS_ROOT_BUDGET');
      }
      const mapped = new Map<PageRec, PageRec>();
      for (const base of basePages) {
        // A record rows place shares the page's geometry, as the store gives it (`geometry.ts`):
        // only a geometry of the model's own is copied.
        const geometry =
          base.geometry && !base.placement ? copyHostGeometry(base.geometry) : base.geometry;
        const rec: PageRec = {
          ...base,
          clusterId: `${id}/${base.clusterId}`,
          matrix: composedPose(transform, base.matrix),
          geometry,
          attributes: geometry?.attributes ?? base.attributes,
          mesh: undefined,
          attached: false,
        };
        if (geometry && geometry !== base.geometry)
          geometryStore.state.allocationBytes += hostPageBytes(geometry);
        mapped.set(base, rec);
        allPages.push(rec);
        baseMaterials.set(rec, baseMaterials.get(base)!);
        let list = byUrl.get(rec.url);
        if (!list) byUrl.set(rec.url, (list = []));
        list.push(rec);
      }
      const addedRoots = baseRoots.map((root) => ({
        ...root,
        world: composedPose(transform, root.world),
        pages: root.pages.map((page) => mapped.get(page)!),
      }));
      const addedBootstrap = baseBootstrap.map((page) => mapped.get(page)!);
      // One by one: a spread of a large world's roots overflows the stack.
      for (const root of addedRoots) roots.push(root);
      for (const page of addedBootstrap) bootstrap.push(page);
      instances.set(id, {
        roots: addedRoots,
        pages: [...mapped.values()],
        bases: [...basePages],
        bootstrap: addedBootstrap,
      });
      coverChanged();
    },
    updateInstance(id: string, transform: Float64Array) {
      sceneChanged();
      const instance = instances.get(id);
      if (!instance) throw new Error('AUTONOMOUS_INSTANCE_MISSING');
      deplaceInstance(instance, baseRoots, transform);
    },
    removeInstance(id: string) {
      sceneChanged();
      const instance = instances.get(id);
      if (!instance) throw new Error('AUTONOMOUS_INSTANCE_MISSING');
      const removed = new Set(instance.roots);
      for (let i = roots.length - 1; i >= 0; i--) if (removed.has(roots[i])) roots.splice(i, 1);
      removeRecords(instance.pages);
      instances.delete(id);
      coverChanged();
      sync();
    },
    updateMaterial(primitive: string, material: Material) {
      sceneChanged();
      const records = allPages.filter(
        (rec) =>
          rec.clusterId.startsWith(`${primitive}/`) || rec.clusterId.includes(`/${primitive}/`),
      );
      if (!records.length) throw new Error('AUTONOMOUS_PRIMITIVE_MISSING');
      // Two host materials at most, built once for the whole primitive: the plain one, and the
      // vertex-coloured twin a page with a colour attribute draws with, taken from the shared
      // cache the decoded pages read. The paint this one replaces is freed below.
      const previous = owned.get(primitive);
      const painted = hostPageSurface(material, false);
      owned.set(primitive, painted);
      const coloured = records.some((rec) => rec.attributes.color)
        ? colouredTwin(colorMaterials, painted)
        : painted;
      for (const rec of records) {
        baseMaterials.set(rec, painted);
        rec.declaration = rec.attributes.color ? coloured : painted;
        rec.material = surfaceOf(rec.declaration);
        if (rec.mesh) setHostSurface(rec.mesh, rec.declaration);
      }
      if (previous) releasePaint(previous);
    },
  };
}
