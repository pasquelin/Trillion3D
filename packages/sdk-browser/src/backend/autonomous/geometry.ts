import type { Scene } from '../../world/core/scene.ts';
import { hostPageBytes, hostPageMesh, releaseHostGeometry } from '../../host/pageObjects.ts';
import { forgetHostPose, setHostPose } from '../../host/pagePose.ts';
import { EngineError, type GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { HostMaterial } from '../../host/resources.ts';
import { createWebglPageBatches } from '../../placement/webglPageBatches.ts';
import { drawnInstancedAt, rowPlacedAt } from '../../placement/autonomousPlacements.ts';
import { rootOf, type ClusterRoot, type PageRec } from '../../page/selection/selection.ts';
import { createHeldResidency } from '../../page/cut/held.ts';
import { createPageStore } from './pageStore.ts';
import type { PageDraw, PageDraws } from './pageDraws.ts';
import type { DeformedDraw } from '../../webgl/cluster/deformation.ts';

type GeometryEnvironment = {
  scene: Scene;
  /** The engine's roots: a page's pose and row are its root's, found by packed rank (#1235). */
  roots: readonly ClusterRoot<PageRec>[];
  allPages: PageRec[];
  bootstrap: PageRec[];
  /** The drawn view's cut, which the scene holds, and every view's lists (`views.ts`). */
  views: {
    readonly live: { readonly shown: readonly PageRec[]; readonly shownPacked: number[] };
    lists(): PageRec[][];
  };
  byUrl: Map<string, PageRec[]>;
  descriptors: Map<string, GeometryPageDescriptor>;
  /** The per-instance draw state, keyed by packed index (`pageDraws.ts`): the record carries none. */
  draws: PageDraws;
  colorMaterials: Map<HostMaterial, HostMaterial>;
  modifiedPages: Set<string>;
  /** The deformation record a page mesh of `rec` names (#357), zero for none. */
  deformWord?: (rec: PageRec, rank: number) => number;
};

const released = new WeakSet<object>();

export function createAutonomousGeometry(env: GeometryEnvironment) {
  const { scene, roots, allPages, byUrl, draws, colorMaterials } = env;
  const state = { allocationBytes: 0, submittedTriangles: 0, residentPages: 0 };
  const held = createHeldResidency(
    {},
    {
      get baseOfRoot() {
        return draws.placement.baseOfRoot;
      },
      get rootOfPacked() {
        return draws.placement.rootOfPacked;
      },
    },
  );
  /** The one writer of a record's residency, its index array: the cut's readiness follows it. Every
   *  instance of the record hears of the flip — one record serves all its primitive's placements. */
  const setArray = (rec: PageRec, array: Uint32Array | undefined) => {
    const moved = !rec.array !== !array;
    rec.array = array;
    if (moved) draws.forEachRank(rec, (packed) => held.moved(packed, rec));
  };
  // Displayed instances, reused from frame to frame; the draw state is the per-packed object.
  const affichees = new Set<PageDraw>();
  // Pages actually attached to the scene, held by `attach` and `detach`. A frame detaches only a
  // delta bounded by the cut: it no longer has to scan the whole DAG to find it.
  const attachees = new Set<PageDraw>();
  const detach = (draw: PageDraw) => {
    if (draw.attached && draw.mesh) {
      scene.remove(draw.mesh);
      forgetHostPose(draw.mesh);
      draw.attached = false;
      attachees.delete(draw);
    }
  };
  const attach = (rec: PageRec, draw: PageDraw, rank: number) => {
    if (!draw.geometry) return;
    // The declaration, not the engine's surface record: the record has no `visible` flag, and
    // the program submits nothing for a surface that is not visible.
    if (!draw.mesh) {
      draw.mesh = hostPageMesh(draw.geometry, rec.declaration, rec.renderOrder);
      (draw.mesh as DeformedDraw).deformRecord = env.deformWord?.(rec, rank) ?? 0;
    }
    setHostPose(draw.mesh, rootOf(roots, rank).world);
    if (!draw.attached) {
      scene.add(draw.mesh);
      draw.attached = true;
      attachees.add(draw);
    }
  };
  // Opaque records placed by rows are drawn instanced, one host mesh per page and surface.
  const batches = createWebglPageBatches(scene, roots, draws),
    rowed: PageRec[] = [],
    rowedPacked: number[] = [];
  const sync = () => {
    const display = env.views.live.shown,
      packed = env.views.live.shownPacked,
      { rootOfPacked } = draws.placement;
    affichees.clear();
    rowed.length = rowedPacked.length = 0;
    for (let i = 0; i < display.length; i++) {
      const rec = display[i],
        draw = draws.at(packed[i])!;
      if (drawnInstancedAt(roots, rootOfPacked[packed[i]], rec)) {
        rowed.push(rec);
        rowedPacked.push(packed[i]);
      } else affichees.add(draw);
    }
    // Removing the current element of a `Set` while iterating it is defined: it will not be revisited.
    for (const draw of attachees) if (!affichees.has(draw)) detach(draw);
    state.submittedTriangles = 0;
    for (let i = 0; i < display.length; i++) {
      const rec = display[i];
      if (!rec.array)
        throw new EngineError(
          'AUTONOMOUS_COVERAGE_MISSING',
          'The prepared autonomous scene does not cover every page the cut requires',
          { page: rec.url },
        );
      if (!drawnInstancedAt(roots, rootOfPacked[packed[i]], rec))
        attach(rec, draws.at(packed[i])!, rootOfPacked[packed[i]]);
      state.submittedTriangles += rec.triangles;
    }
    batches.draw(rowed, rowedPacked);
  };
  /** Detaches a record, frees its geometry once unless `keep` (an instance's rowed record). */
  const release = (rec: PageRec, keep = false) => {
    const draw = draws.drawing(rec);
    detach(draw);
    const geometry = draw.geometry;
    if (!keep && geometry && !released.has(geometry)) {
      released.add(geometry);
      state.allocationBytes -= hostPageBytes(geometry);
      releaseHostGeometry(geometry);
    }
    draw.geometry = draw.mesh = undefined;
    setArray(rec, undefined);
  };
  // An instance's or a mount's records (#572): a rowed geometry is freed with its last reader.
  const removeRecords = (records: PageRec[]) => {
    const removed = new Set(records);
    for (const rec of records) {
      const list = byUrl.get(rec.url) ?? [],
        index = list.indexOf(rec);
      // Already gone — an unmount took the row an instance copied —: its rank names no root now.
      if (index < 0) continue;
      list.splice(index, 1);
      // Resident until its last HOLDING record leaves: a mount's may still wait for its bytes.
      if (rec.array && !list.some((other) => other.array)) state.residentPages--;
      if (!list.length) byUrl.delete(rec.url);
      const geometry = draws.find(rec)?.geometry;
      release(
        rec,
        rowPlacedAt(roots, draws.rootRankOf(rec)) &&
          list.some((other) => draws.find(other)?.geometry === geometry),
      );
      draws.forget(rec);
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
    draws,
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
