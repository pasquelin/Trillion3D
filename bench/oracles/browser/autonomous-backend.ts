import { numbered } from '../../../packages/sdk-browser/src/host/graph/serial.ts';
import { Mesh } from '../../../packages/sdk-core/src/world/object/mesh.ts';
import type { Scene } from '../../../packages/sdk-browser/src/world/core/scene.ts';
import type { GraphSurface } from '../../../packages/sdk-browser/src/host/graph/surface.ts';
import { asHostLibrary } from '../../../packages/sdk-browser/src/host/resources.ts';
import type { PageRec as EngineRec } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { MatrixElements } from '../../../packages/sdk-browser/src/math/matrixElements.ts';

/** A record as the oracle read it, before #1226 and #1234: the world of its root and the
 *  per-instance draw state the engine kept on the record then. */
type PageRec = EngineRec & {
  matrix: MatrixElements;
  geometry?: Geometry;
  mesh?: HostMesh;
  attached: boolean;
};
import type { Geometry } from '../../../packages/sdk-core/src/world/geometry/geometry.ts';
import type { HostMesh } from '../../../packages/sdk-browser/src/host/resources.ts';

/**
 * `packages/sdk-browser/src/backend/autonomous/geometry.ts` before batch G: `attach` and `detach` held no set, and
 * `sync` swept all of `allPages` — the whole DAG — to find the few pages the new
 * cut drops. The three functions are copied as-is: that is the oracle.
 */
export function referenceAutonomousSync({
  scene,
  allPages,
  shown,
}: {
  scene: Scene;
  allPages: PageRec[];
  shown: PageRec[];
}) {
  const state = { submittedTriangles: 0 };
  const affichees = new Set<PageRec>();
  const detach = (rec: PageRec) => {
    if (rec.attached && rec.mesh) {
      scene.remove(rec.mesh);
      rec.attached = false;
    }
  };
  const attach = (rec: PageRec) => {
    if (!rec.geometry) return;
    if (!rec.mesh) {
      const mesh = numbered(
        new Mesh(asHostLibrary<Geometry>(rec.geometry), asHostLibrary<GraphSurface>(rec.material)),
      );
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = rec.renderOrder;
      rec.mesh = mesh;
    }
    const placed = rec.mesh;
    placed.matrix.fromArray(rec.matrix.elements);
    if (!rec.attached) {
      scene.add(placed);
      rec.attached = true;
    }
  };
  const sync = () => {
    const display = shown;
    affichees.clear();
    for (const rec of display) affichees.add(rec);
    for (const rec of allPages) if (rec.attached && !affichees.has(rec)) detach(rec);
    state.submittedTriangles = 0;
    for (const rec of display) {
      if (!rec.array) throw new Error('AUTONOMOUS_COVERAGE_MISSING');
      attach(rec);
      state.submittedTriangles += rec.triangles;
    }
  };
  return { state, sync };
}
