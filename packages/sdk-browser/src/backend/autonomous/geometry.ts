import type { Scene } from '../../world/core/scene.ts';
import {
  colouredTwin,
  hostPageBytes,
  hostPageGeometry,
  hostPageMesh,
  releaseHostGeometry,
} from '../../host/pageObjects.ts';
import { forgetHostPose, setHostPose } from '../../host/pagePose.ts';
import { wearDeclaration } from '../../page/surface.ts';
import { EngineError, type GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { HostMaterial, HostMaterials } from '../../host/resources.ts';
import { createWebglPageBatches } from '../../placement/webglPageBatches.ts';
import { drawnInstanced } from '../../placement/autonomousPlacements.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';
import { createHeldResidency } from '../../page/cut/held.ts';
import { assertWithinBox, itemSize } from './pageData.ts';

type GeometryEnvironment = {
  scene: Scene;
  allPages: PageRec[];
  bootstrap: PageRec[];
  /** The drawn view's cut, which the scene holds, and every view's lists (`views.ts`). */
  views: { readonly live: { readonly shown: readonly PageRec[] }; lists(): PageRec[][] };
  byUrl: Map<string, PageRec[]>;
  descriptors: Map<string, GeometryPageDescriptor>;
  baseMaterials: Map<PageRec, HostMaterials>;
  colorMaterials: Map<HostMaterial, HostMaterial>;
  modifiedPages: Set<string>;
};

const released = new WeakSet<object>();

export function createAutonomousGeometry(env: GeometryEnvironment) {
  const { scene, allPages, byUrl, baseMaterials, colorMaterials } = env;
  const state = { allocationBytes: 0, submittedTriangles: 0, residentPages: 0 };
  const held = createHeldResidency();
  /** The one writer of a record's residency, its index array: the cut's readiness follows it. */
  const setArray = (rec: PageRec, array: Uint32Array | undefined) => {
    const moved = !rec.array !== !array;
    rec.array = array;
    if (moved) held.moved(rec);
  };
  const affichees = new Set<PageRec>(); // displayed pages, reused from frame to frame
  // Pages actually attached to the scene, held by `attach` and `detach`. A frame detaches
  // only a delta bounded by the cut: it no longer has to scan the whole DAG to find it.
  const attachees = new Set<PageRec>();
  const detach = (rec: PageRec) => {
    if (rec.attached && rec.mesh) {
      scene.remove(rec.mesh);
      forgetHostPose(rec.mesh);
      rec.attached = false;
      attachees.delete(rec);
    }
  };
  const attach = (rec: PageRec) => {
    if (!rec.geometry) return;
    // The declaration, not the engine's surface record: the record has no `visible` flag, and
    // the program submits nothing for a surface that is not visible.
    rec.mesh ??= hostPageMesh(rec.geometry, rec.declaration, rec.renderOrder);
    setHostPose(rec.mesh, rec.matrix);
    if (!rec.attached) {
      scene.add(rec.mesh);
      rec.attached = true;
      attachees.add(rec);
    }
  };
  // Opaque records placed by rows are drawn instanced, one host mesh per page and surface.
  const batches = createWebglPageBatches(scene),
    rowed: PageRec[] = [];
  const sync = () => {
    const display = env.views.live.shown;
    affichees.clear();
    rowed.length = 0;
    for (const rec of display)
      if (drawnInstanced(rec)) rowed.push(rec);
      else affichees.add(rec);
    // Removing the current element of a `Set` while iterating it is defined: it will not be revisited.
    for (const rec of attachees) if (!affichees.has(rec)) detach(rec);
    state.submittedTriangles = 0;
    for (const rec of display) {
      if (!rec.array)
        throw new EngineError(
          'AUTONOMOUS_COVERAGE_MISSING',
          'The prepared autonomous scene does not cover every page the cut requires',
          { page: rec.url },
        );
      if (!drawnInstanced(rec)) attach(rec);
      state.submittedTriangles += rec.triangles;
    }
    batches.draw(rowed);
  };
  /** Detaches a record, frees its geometry once unless `keep` (an instance's rowed record). */
  const release = (rec: PageRec, keep = false) => {
    detach(rec);
    const geometry = rec.geometry;
    if (!keep && geometry && !released.has(geometry)) {
      released.add(geometry);
      state.allocationBytes -= hostPageBytes(geometry);
      releaseHostGeometry(geometry);
    }
    rec.geometry = rec.mesh = undefined;
    setArray(rec, undefined);
  };
  // An instance's or a mount's records (#572): a rowed geometry is freed with its last reader.
  const removeRecords = (records: PageRec[]) => {
    const removed = new Set(records);
    for (const rec of records) {
      const list = byUrl.get(rec.url) ?? [],
        index = list.indexOf(rec);
      if (index >= 0) list.splice(index, 1);
      // Resident until its last HOLDING record leaves: a mount's may still wait for its bytes.
      if (rec.array && !list.some((other) => other.array)) state.residentPages--;
      if (!list.length) byUrl.delete(rec.url);
      release(rec, !!rec.placement && list.some((other) => other.geometry === rec.geometry));
      baseMaterials.delete(rec);
    }
    for (const list of [allPages, env.bootstrap, ...env.views.lists()])
      for (let i = list.length - 1; i >= 0; i--) if (removed.has(list[i])) list.splice(i, 1);
  };
  /** The pages the host replaced, as it wrote them: a record that joins one later — a mount —
   *  draws the host's page, never the cache's, and neither do the others then (#837). */
  const replaced = new Map<string, DecodedGeometryPage>();
  /** Stores `given`, or the host's page where it replaced this one; `host` replaces it. */
  const storeGeometryPage = (url: string, given: DecodedGeometryPage, host = false) => {
    const recs = byUrl.get(url);
    if (!recs) return false;
    const data = host ? given : (replaced.get(url) ?? given);
    const descriptor = env.descriptors.get(url);
    if (
      !descriptor ||
      data.vertexCount !== descriptor.vertexCount ||
      data.indices.length !== descriptor.indexCount ||
      data.flags !== descriptor.flags
    )
      throw new Error('AUTONOMOUS_PAGE_METADATA_MISMATCH');
    if (recs[0] && !recs[0].array) state.residentPages++;
    let rowedGeometry: ReturnType<typeof hostPageGeometry> | undefined;
    for (const rec of recs) {
      release(rec);
      // Records placed by rows share the page: its geometry, its box and the check of it.
      const shared = !!rec.placement && !!rowedGeometry;
      if (!shared) assertWithinBox(data, rec);
      const geometry = shared ? rowedGeometry! : hostPageGeometry(data, itemSize, rec.min, rec.max);
      if (rec.placement) rowedGeometry = geometry;
      const base = baseMaterials.get(rec)!;
      // Lazily: a page without a colour attribute must not make a vertex-coloured twin.
      const twin = (one: HostMaterial) => colouredTwin(colorMaterials, one);
      const paint = () => (Array.isArray(base) ? base.map(twin) : twin(base));
      wearDeclaration(rec, data.attributes.color ? paint() : base);
      setArray(rec, data.indices);
      rec.attributes = geometry.attributes;
      rec.geometry = geometry;
      // Each geometry uploads its own buffers: counted as `release` gives them back.
      if (!shared) state.allocationBytes += hostPageBytes(geometry);
    }
    // Kept once every check passed: a refused page never stands in for the cache's.
    if (host) replaced.set(url, given);
    return recs.length > 0;
  };
  // True when the store now holds the page: the host did not replace it, and a record draws it.
  const acceptGeometryPage = (url: string, data: DecodedGeometryPage) =>
    !env.modifiedPages.has(url) && storeGeometryPage(url, data);
  return {
    state,
    /** The cut's residency: each record's index array, its readiness moved as `setArray` writes. */
    held,
    /** The one twin cache of the backend: whoever paints a surface reads it through here. */
    colorMaterials,
    sync,
    /** Rows were written or rebound: the instanced pages read them again at the next sync. */
    rowsWritten: batches.rowsWritten,
    /** Gives back every page's mesh and geometry, and the instanced pages: the backend ends. */
    dispose() {
      batches.clear();
      for (const rec of allPages) release(rec);
    },
    /** Gives a page's geometry back in every record that draws it; true when it held some. */
    releasePage(url: string) {
      let had = false;
      for (const rec of byUrl.get(url) ?? []) {
        had ||= !!rec.array;
        release(rec);
      }
      if (had) state.residentPages--;
      return had;
    },
    removeRecords,
    storeGeometryPage,
    /** Records that joined pages the host replaced — a mount's — draw the host's pages. */
    storeReplaced(urls: readonly string[]) {
      for (const url of urls) {
        const data = replaced.get(url);
        if (data) storeGeometryPage(url, data);
      }
    },
    acceptGeometryPage,
  };
}
