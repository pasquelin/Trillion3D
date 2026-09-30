// The witness draws each record at a pose it holds on the record, as the engine's records did
// before #1226. The engine's records carry none — their root does —, so the witness copies its
// root's world onto each of its records, once, at its collection.
import type {
  ClusterRoot,
  PageRec,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { MatrixElements } from '../../../packages/sdk-browser/src/math/matrixElements.ts';
import type { Geometry } from '../../../packages/sdk-core/src/world/geometry/geometry.ts';
import type { HostMesh } from '../../../packages/sdk-browser/src/host/resources.ts';

/** A record of the witness: the engine's, the world of the root that places it, and the
 *  per-instance draw state the engine kept on the record before #1234. */
export type WitnessPage = PageRec & {
  matrix: MatrixElements;
  geometry?: Geometry;
  mesh?: HostMesh;
  attached: boolean;
  resident?: boolean;
};

/** Poses the pages of `roots` at their root's world, in place, and returns them as the witness reads them. */
export function posedRoots(roots: ClusterRoot<PageRec>[]) {
  for (const root of roots)
    for (const page of root.pages) (page as WitnessPage).matrix = root.world;
  return roots as ClusterRoot<WitnessPage>[];
}
