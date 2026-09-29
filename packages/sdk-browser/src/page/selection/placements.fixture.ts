import * as G from '../../host/graph/graph.fixture.ts';
import type { MatrixElements } from '../../math/matrixElements.ts';

/** One root at the identity: what a test page of `placementIndex: 0` is placed by. */
export const identityRoots = () => [{ world: new G.Matrix4() as MatrixElements }];

/** Test pages that each name their world: the pages without it, each ranking a root of its own
 *  that carries it, as an engine's pages rank theirs (`placements.ts`). */
export function placedPages<T extends { matrix: MatrixElements }>(list: readonly T[]) {
  const roots = list.map(({ matrix }) => ({ world: matrix }));
  const pages = list.map(({ matrix: _, ...page }, placementIndex) => ({ ...page, placementIndex }));
  return { pages, roots };
}
