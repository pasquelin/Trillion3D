import * as G from '../../host/graph/graph.fixture.ts';
import type { MatrixElements } from '../../math/matrixElements.ts';

/** One root at the identity: what a test page of `placementIndex: 0` is placed by. */
export const identityRoots = () => [{ world: new G.Matrix4() as MatrixElements }];
