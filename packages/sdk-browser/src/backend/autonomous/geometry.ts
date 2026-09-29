import type { Scene } from '../../world/core/scene.ts';
import { hostPageBytes, hostPageMesh, releaseHostGeometry } from '../../host/pageObjects.ts';
import { forgetHostPose, setHostPose } from '../../host/pagePose.ts';
import { EngineError, type GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { HostMaterial, HostMaterials } from '../../host/resources.ts';
import { createWebglPageBatches } from '../../placement/webglPageBatches.ts';
import { drawnInstanced } from '../../placement/autonomousPlacements.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { createHeldResidency } from '../../page/cut/held.ts';
import { createPageStore } from './pageStore.ts';
import type { DeformedDraw } from '../../webgl/cluster/deformation.ts';

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
  /** The deformation record a page mesh of `rec` names (#357), zero for none. */
  deformWord?: (rec: PageRec) => number;
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
    if (!rec.mesh) {
      rec.mesh = hostPageMesh(rec.geometry, rec.declaration, rec.renderOrder);
      (rec.mesh as DeformedDraw).deformRecord = env.deformWord?.(rec) ?? 0;
    }
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
  const store = createPageStore({ ...env, release, setArray, state });
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
    ...store,
  };
}
