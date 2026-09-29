import type { GeometryPageDescriptor } from '../../../sdk-core/src/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { Scene } from '../world/core/scene.ts';
import {
  collectClusterPages,
  type PageRec,
  type ClusterRoot,
} from '../page/selection/selection.ts';
import type { WebglFrameGate } from '../webgl/core/frameGate.ts';
import { followPlacementRows, forgetRowRoots } from './update.ts';
import type { PlacementOf, PlacementRows } from './rows.ts';
import { growRowRoots } from './growth.ts';
import type { BlendCopy } from '../cluster/blendCopyContract.ts';
import { createBlendCopy, followBlendCopies, growBlendCopies } from '../cluster/blendCopyMesh.ts';
import {
  autonomousBootstrap,
  prepareAutonomousManifest,
  readPages,
} from '../backend/autonomous/manifest.ts';
import type { HostMaterials } from '../host/resources.ts';
import type { BackendContext } from '../backend/types.ts';
import type { createAutonomousGeometry } from '../backend/autonomous/geometry.ts';
import type { PlacementMount } from './backendSceneUpdates.ts';
import { rootChildren } from '../residency/minimumCapacity.ts';
import { poseNamed } from '../host/world/moveByName.ts';

/** Addresses already counted, reused across calls: nothing is allocated to count a frame. */
const counted = new Set<string>();

/**
 * True when a record is drawn instanced with the other rows of its page (`webglPageBatches.ts`).
 * A transparent record placed by a row is drawn on its own, like a blended copy: the host orders
 * blended meshes by depth, never the instances of one draw. `transparent`, the flag it would take.
 */
export const drawnInstanced = (rec: PageRec, transparent = rec.transparent) =>
  !!rec.placement && !transparent;

/**
 * The host meshes `recs` hang on the WebGL2 path's display graph, which its page ceiling bounds:
 * one per record drawn on its own, one per PAGE for the records drawn instanced — ten thousand
 * opaque placements of a page are one mesh.
 */
export function attachedPages(recs: readonly PageRec[], instanced = drawnInstanced) {
  counted.clear();
  let own = 0;
  for (const rec of recs)
    if (instanced(rec)) counted.add(rec.url);
    else own++;
  return own + counted.size;
}

type Placements = {
  context: BackendContext;
  roots: ClusterRoot<PageRec>[];
  allPages: PageRec[];
  bootstrap: PageRec[];
  bootstrapUrls: Set<string>;
  byUrl: Map<string, PageRec[]>;
  descriptors: Map<string, GeometryPageDescriptor>;
  baseMaterials: Map<PageRec, HostMaterials>;
  /** The host copies of blended and transmissive surfaces, and the graph that shows them. */
  blendCopies: BlendCopy[];
  scene: Scene;
  gate: WebglFrameGate;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  /** Notified when grown or mounted rows add records to the root cover, or unmounted ones remove. */
  coverChanged: () => void;
};

/** The instance-buffer updates of the WebGL2 path, its mounts in place included (#572). */
export function autonomousPlacements(env: Placements) {
  const { roots, allPages, bootstrap, byUrl, baseMaterials, blendCopies, scene, gate } = env;
  const { context, descriptors, bootstrapUrls, geometryStore, coverChanged } = env,
    { rowsWritten } = geometryStore;
  /** The pages a mount in flight admitted and still reads: an unmount keeps them catalogued. */
  const reading = new Map<string, number>();
  const count = (urls: readonly string[], by: number) => {
    for (const url of urls) {
      const n = (reading.get(url) ?? 0) + by;
      if (n > 0) reading.set(url, n);
      else reading.delete(url);
    }
  };
  /** The roots changed: their rows' index is built again, the cover counted, the frame drawn. */
  const changed = () => {
    rowsWritten();
    forgetRowRoots(roots);
    coverChanged();
    gate.sceneChanged();
  };
  return {
    /** WebGL2's move by name (#972): the node the name index finds, posed as WebGPU poses it
     *  (`poseNode`), from the parent world its host chain composes. The next image walks the
     *  engine index and follows it as it follows a host write, which the move settles. */
    setTransform(nodeName: string, matrix: Float32Array) {
      if (poseNamed(context.source, nodeName, matrix)) gate.sceneMoved();
    },
    /** The roots follow their rows, and a frame that moved something is not held. The instanced
     *  pages read the rows at the next frame's sync; the blended copies posed by rows read them in
     *  place and take their flag here (`blendCopyMesh.ts`). */
    updatePlacements(rows: PlacementRows, from: number, to: number) {
      rowsWritten();
      const moved = followPlacementRows(roots, rows, from, to);
      if (followBlendCopies(blendCopies, rows, from, to) || moved) gate.sceneMoved();
    },
    /** The growth contract (`growth.ts`): every table of this path is a list, so the
     *  new rows' roots and pages are appended to them, indexed like the ones collected. */
    growPlacements(from: PlacementRows, to: PlacementRows) {
      for (const { item: root, template } of growRowRoots(roots, from, to)) {
        roots.push(root);
        root.pages.forEach((rec, rank) => {
          allPages.push(rec);
          baseMaterials.set(rec, baseMaterials.get(template.pages[rank])!);
          byUrl.get(rec.url)!.push(rec);
        });
        bootstrap.push(...autonomousBootstrap([root]));
      }
      growBlendCopies(blendCopies, from, to, (copy) => scene.add(copy));
      changed();
    },
    /** A resource is collected as the open collects one, its root cover read and decoded, and only
     *  then appended to the open's tables: never drawn before its cover is resident. */
    async mountPlacements({ node, association, primitive }: PlacementMount) {
      const read = prepareAutonomousManifest({ ...context.metadata, primitives: [primitive] });
      const associations = new Map<Object3D, PlacementMount['association']>([[node, association]]);
      const collected = collectClusterPages(node, read.metadata, new Map(), associations, {
        allowMissing: true,
        blendCopy: createBlendCopy,
      });
      const cover = autonomousBootstrap(collected.roots);
      rootChildren(collected.roots); // admitted first, as the open's (`minimumCapacity.ts`)
      const covered = new Set(cover.map((rec) => rec.url)),
        urls = [...covered];
      const admitted = [...read.descriptors.keys()];
      context.pageCatalogue?.admit([...read.descriptors.values()]);
      count(admitted, 1);
      const pages = await readPages(context, urls).finally(() => count(admitted, -1));
      context.signal?.throwIfAborted();
      for (const [url, descriptor] of read.descriptors) descriptors.set(url, descriptor);
      // One by one: a spread of a large resource's records overflows the stack.
      for (const root of collected.roots) roots.push(root);
      for (const rec of collected.allPages) {
        allPages.push(rec);
        baseMaterials.set(rec, rec.declaration);
        (byUrl.get(rec.url) ?? byUrl.set(rec.url, []).get(rec.url)!).push(rec);
      }
      for (const rec of cover) bootstrap.push(rec);
      for (const rec of cover) bootstrapUrls.add(rec.url);
      for (const copy of collected.blendCopies) blendCopies.push(copy);
      for (const copy of collected.blendCopies) scene.add(copy as unknown as Object3D);
      urls.forEach((url, i) => geometryStore.storeGeometryPage(url, pages[i]));
      // A page the host replaced stays the host's, the cover's as the others (#837).
      geometryStore.storeReplaced(admitted.filter((url) => !covered.has(url)));
      changed();
    },
    /** The resource `rows` place leaves: its roots, copies, and each page with its last record. */
    unmountPlacements(rows: PlacementRows) {
      const placed = (item: { placement?: PlacementOf }) => item.placement?.rows === rows;
      const records: PageRec[] = [],
        urls = new Set<string>();
      for (let i = roots.length - 1; i >= 0; i--) {
        if (!placed(roots[i])) continue;
        for (const rec of roots.splice(i, 1)[0].pages) {
          records.push(rec);
          urls.add(rec.url);
        }
      }
      for (let i = blendCopies.length - 1; i >= 0; i--)
        if (placed(blendCopies[i]))
          scene.remove(blendCopies.splice(i, 1)[0] as unknown as Object3D);
      geometryStore.removeRecords(records);
      const gone: string[] = [];
      for (const url of urls) {
        // Still drawn, or read by a mount in flight: it stays catalogued.
        if (byUrl.has(url) || reading.has(url)) continue;
        descriptors.delete(url);
        bootstrapUrls.delete(url);
        gone.push(url);
      }
      context.pageCatalogue?.forget(gone);
      changed();
    },
  };
}
