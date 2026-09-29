// The witness draws each record at a pose it holds on the record, as the engine's records did
// before #1226. The engine's records carry none — their root does —, so the witness copies its
// root's world onto each of its records, once, at its collection.
import type {
  ClusterRoot,
  PageRec,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { MatrixElements } from '../../../packages/sdk-browser/src/math/matrixElements.ts';

/** A record of the witness: the engine's, and the world of the root that places it. */
export type WitnessPage = PageRec & { matrix: MatrixElements };

/** Poses the pages of `roots` at their root's world, in place, and returns them as the witness reads them. */
export function posedRoots(roots: ClusterRoot<PageRec>[]) {
  for (const root of roots)
    for (const page of root.pages) (page as WitnessPage).matrix = root.world;
  return roots as ClusterRoot<WitnessPage>[];
}
