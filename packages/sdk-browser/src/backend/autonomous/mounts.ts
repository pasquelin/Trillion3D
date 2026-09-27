import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { BlendCopy } from '../../cluster/blendCopyContract.ts';
import { createBlendCopy } from '../../cluster/blendCopyMesh.ts';
import type { GraphScene } from '../../host/graph/scene.ts';
import type { HostMaterials } from '../../host/resources.ts';
import {
  collectClusterPages,
  type ClusterRoot,
  type PageRec,
} from '../../page/selection/selection.ts';
import type { PlacementMount } from '../../placement/backendSceneUpdates.ts';
import type { PlacementOf, PlacementRows } from '../../placement/rows.ts';
import type { WebglFrameGate } from '../../webgl/core/frameGate.ts';
import type { BackendContext } from '../types.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import { autonomousBootstrap, prepareAutonomousManifest, readPages } from './manifest.ts';

/** The tables of the WebGL2 path a placement enters, and what tells the frame they moved. */
export type PlacementTables = {
  context: BackendContext;
  roots: ClusterRoot<PageRec>[];
  allPages: PageRec[];
  bootstrap: PageRec[];
  byUrl: Map<string, PageRec[]>;
  baseMaterials: Map<PageRec, HostMaterials>;
  descriptors: Map<string, GeometryPageDescriptor>;
  bootstrapUrls: Set<string>;
  blendCopies: BlendCopy[];
  scene: GraphScene;
  gate: WebglFrameGate;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  /** Notified when grown rows or a mount add records to the root cover, or remove them. */
  coverChanged: () => void;
};

/**
 * THE MOUNT IN PLACE OF THE WEBGL2 PATH (#572, `BackendSceneUpdates.mountPlacements`): a resource
 * the session was not opened with is collected as the open collects one (`collectClusterPages`),
 * its root cover read and decoded like the open's, and only then are its roots, records, pages and
 * copies appended to the open's tables — never drawn before its cover is resident. Unmounting
 * takes them out again, each page's geometry freed with the last record that draws it.
 */
export function createAutonomousMounts(env: PlacementTables) {
  const { context, roots, allPages, bootstrap, byUrl, baseMaterials, geometryStore } = env;
  const { descriptors, bootstrapUrls, blendCopies, scene, gate, coverChanged } = env;
  return {
    async mountPlacements({ node, association, primitive }: PlacementMount) {
      const read = prepareAutonomousManifest({ ...context.metadata, primitives: [primitive] });
      const associations = new Map<Object3D, PlacementMount['association']>([[node, association]]);
      const collected = collectClusterPages(node, read.metadata, new Map(), associations, {
        allowMissing: true,
        blendCopy: createBlendCopy,
      });
      const cover = autonomousBootstrap(collected.roots);
      const urls = [...new Set(cover.map((rec) => rec.url))];
      context.pageCatalogue?.admit([...read.descriptors.values()]);
      const pages = await readPages(context, urls);
      context.signal?.throwIfAborted();
      for (const [url, descriptor] of read.descriptors) descriptors.set(url, descriptor);
      // One by one: a spread of a large resource's records overflows the stack.
      for (const root of collected.roots) roots.push(root);
      for (const rec of collected.allPages) {
        allPages.push(rec);
        baseMaterials.set(rec, rec.declaration);
        let list = byUrl.get(rec.url);
        if (!list) byUrl.set(rec.url, (list = []));
        list.push(rec);
      }
      for (const rec of cover) {
        bootstrap.push(rec);
        bootstrapUrls.add(rec.url);
      }
      for (const copy of collected.blendCopies) {
        blendCopies.push(copy);
        scene.add(copy as unknown as Object3D);
      }
      urls.forEach((url, i) => geometryStore.storeGeometryPage(url, pages[i]));
      geometryStore.rowsWritten();
      coverChanged();
      gate.sceneChanged();
    },
    unmountPlacements(rows: PlacementRows) {
      const placed = (item: { placement?: PlacementOf }) => item.placement?.rows === rows;
      const records: PageRec[] = [];
      for (let i = roots.length - 1; i >= 0; i--)
        if (placed(roots[i])) records.push(...roots.splice(i, 1)[0].pages);
      for (let i = blendCopies.length - 1; i >= 0; i--)
        if (placed(blendCopies[i]))
          scene.remove(blendCopies.splice(i, 1)[0] as unknown as Object3D);
      const resident = new Set(records.flatMap((rec) => (rec.array ? [rec.url] : [])));
      geometryStore.removeRecords(records);
      const gone = [...new Set(records.map((rec) => rec.url))].filter(
        (url) => !byUrl.get(url)?.length,
      );
      for (const url of gone) {
        if (resident.has(url)) geometryStore.state.residentPages--;
        byUrl.delete(url);
        descriptors.delete(url);
        bootstrapUrls.delete(url);
      }
      context.pageCatalogue?.forget(gone);
      coverChanged();
      gate.sceneChanged();
    },
  };
}
