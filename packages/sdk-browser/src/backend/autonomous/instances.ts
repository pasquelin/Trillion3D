import type { Material } from '../../../../sdk-core/src/index.ts';
import type { HostMaterial } from '../../host/resources.ts';
import { copyHostGeometry, hostPageBytes, hostPageSurface } from '../../host/pageObjects.ts';
import { recordsBySurface, unpagedRefusal } from '../../page/surface.ts';
import type { PageRec, ClusterRoot } from '../../page/selection/selection.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import type { PageDraws } from './pageDraws.ts';
import { createPaints } from './paints.ts';
import { composedPose, deplaceInstance } from './instancePose.ts';
import { attachedPages, drawnInstancedAt } from '../../placement/autonomousPlacements.ts';
import type { HeldFloor } from './heldFloor.ts';
import { blendMoves, type AlphaChange } from '../../placement/backendSceneUpdates.ts';
import type { SurfaceAssignment } from '../../placement/backendSceneUpdates.ts';

type InstanceEnvironment = {
  roots: ClusterRoot<PageRec>[];
  baseRoots: ClusterRoot<PageRec>[];
  allPages: PageRec[];
  basePages: PageRec[];
  bootstrap: PageRec[];
  baseBootstrap: PageRec[];
  byUrl: Map<string, PageRec[]>;
  /** The per-instance draw state, keyed by packed index (`pageDraws.ts`). */
  draws: PageDraws;
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
  blendOf: (rec: PageRec, alpha: AlphaChange) => boolean | undefined;
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
    draws,
    geometryStore,
    hostCeiling,
    overCeiling,
    blendOf,
    sceneChanged,
    coverChanged,
  } = env;
  type Instance = { roots: ClusterRoot<PageRec>[]; pages: PageRec[]; bootstrap: PageRec[] };
  const instances = new Map<string, Instance>();
  // The model's records rows place, read off their roots once: a root may leave `roots` later.
  const rowed = new Set(baseRoots.flatMap((root) => (root.placement ? root.pages : [])));
  const { removeRecords, sync, colorMaterials } = geometryStore;
  const paints = createPaints(colorMaterials, draws);
  return {
    /** Why a move into or out of blended takes the cover past the host ceiling, before any write
     *  (#846): rows are one instanced mesh while opaque, one mesh a row once blended. */
    materialClassRefusal(alpha: AlphaChange) {
      const unpaged = unpagedRefusal(allPages, alpha);
      if (unpaged) return unpaged;
      const instanced = (rec: PageRec) =>
        drawnInstancedAt(roots, draws.rootRankOf(rec), rec, blendOf(rec, alpha));
      if (blendMoves(alpha) && overCeiling(0, attachedPages(bootstrap, instanced)))
        return 'AUTONOMOUS_ROOT_BUDGET: the cover would hang more meshes than the host allows';
    },
    /** Classic instances held: each holds its own copy of every page geometry. */
    instanceCount: () => instances.size,
    disposeOwnedMaterials: () => paints.dispose(),
    addInstance(id: string, transform: Float64Array) {
      sceneChanged();
      if (instances.has(id) || !id) throw new Error('AUTONOMOUS_INSTANCE_ID');
      // Without a host ceiling the cover is always drawn: nothing is counted.
      if (hostCeiling < Infinity) {
        // The meshes it adds: one per record drawn on its own, its rows joining the cover's instanced
        // ones (`attachedPages`); counted now, as a class change moves records between them (#846).
        const ownMeshes = baseBootstrap.filter((rec) => !rowed.has(rec) || rec.transparent).length;
        if (overCeiling(ownMeshes)) throw new Error('AUTONOMOUS_ROOT_BUDGET');
      }
      const mapped = new Map<PageRec, PageRec>(),
        copied: Array<{ base: PageRec; rec: PageRec; geometry: Geometry | undefined }> = [];
      for (const base of basePages) {
        // A record rows place shares the page's geometry, as the store gives it (`geometry.ts`):
        // only a geometry of the model's own is copied.
        const source = draws.find(base)?.geometry,
          geometry = source && !rowed.has(base) ? copyHostGeometry(source) : source;
        const rec: PageRec = {
          ...base,
          clusterId: `${id}/${base.clusterId}`,
          attributes: geometry?.attributes ?? base.attributes,
        };
        if (geometry && geometry !== source)
          geometryStore.state.allocationBytes += hostPageBytes(geometry);
        mapped.set(base, rec);
        allPages.push(rec);
        let list = byUrl.get(rec.url);
        if (!list) byUrl.set(rec.url, (list = []));
        list.push(rec);
        copied.push({ base, rec, geometry });
      }
      const addedRoots = baseRoots.map((root) => ({
        ...root,
        world: composedPose(transform, root.world),
        pages: root.pages.map((page) => mapped.get(page)!),
      }));
      const addedBootstrap = baseBootstrap.map((page) => mapped.get(page)!);
      // The material each copy inherits, read before the layout moves the base ranks.
      const materials = copied.map(({ base }) => draws.find(base)?.material);
      // One by one: a spread of a large world's roots overflows the stack. Its pages rank them.
      for (const root of addedRoots) roots.push(root);
      draws.layOut(roots);
      for (let i = 0; i < copied.length; i++) {
        const draw = draws.drawing(copied[i].rec);
        draw.geometry = copied[i].geometry;
        draw.material = materials[i];
      }
      for (const page of addedBootstrap) bootstrap.push(page);
      instances.set(id, {
        roots: addedRoots,
        pages: [...mapped.values()],
        bootstrap: addedBootstrap,
      });
      coverChanged();
    },
    updateInstance(id: string, transform: Float64Array) {
      sceneChanged();
      const instance = instances.get(id);
      if (!instance) throw new Error('AUTONOMOUS_INSTANCE_MISSING');
      deplaceInstance(instance, baseRoots, transform, draws);
    },
    removeInstance(id: string) {
      sceneChanged();
      const instance = instances.get(id);
      if (!instance) throw new Error('AUTONOMOUS_INSTANCE_MISSING');
      const removed = new Set(instance.roots);
      // Its records leave while their roots still place them: a release reads their rows.
      removeRecords(instance.pages);
      for (let i = roots.length - 1; i >= 0; i--) if (removed.has(roots[i])) roots.splice(i, 1);
      draws.layOut(roots);
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
      // Built once for the whole primitive; the paint this one replaces is freed below.
      const painted = hostPageSurface(material, false),
        previous = paints.repaint(primitive, painted);
      paints.wear(records, painted);
      if (previous) paints.release(previous);
    },
    /** Each assigned mesh's records wear its surface (`wearSurface`, #847); copies refused. A
     *  paint of this engine's that no record wears any more is freed, as a repaint frees it. */
    wearSurface({ meshes }: SurfaceAssignment) {
      sceneChanged();
      for (const [surface, records] of recordsBySurface(allPages, meshes))
        paints.wear(records, surface as HostMaterial);
      // A page seldom repaints: `entries` is most often empty, and this walk runs for none.
      for (const [primitive, painted] of paints.entries())
        if (!allPages.some((rec) => draws.drawing(rec).material === painted)) {
          paints.forget(primitive);
          paints.release(painted);
        }
    },
  };
}
