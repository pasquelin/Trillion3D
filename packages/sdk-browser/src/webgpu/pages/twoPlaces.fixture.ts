import * as G from '../../host/graph/graph.fixture.ts';
import { triangleGeometry } from '../../backend/pagesBackendScenes.fixture.ts';
import { rootPage, twoPrimitives } from './testScenes.fixture.ts';

/** Two meshes twenty units apart, one root cluster each: a camera sees both, or the second only. */
export function twoPlacesScene() {
  const geoA = triangleGeometry([-1, -1, 0, 1, -1, 0, 1, 1, 0]),
    geoB = triangleGeometry([20, -1, 0, 22, -1, 0, 22, 1, 0]);
  const front = G.basicSurface({ color: 0xff0000, side: G.FRONT_SIDE }),
    both = G.basicSurface({ color: 0x00ff00, side: G.DOUBLE_SIDE });
  const meshA = G.mesh(geoA, front),
    meshB = G.mesh(geoB, both),
    source = new G.Group();
  source.add(meshA, meshB);
  const pages = twoPrimitives(
    meshA,
    meshB,
    rootPage('0', [-1, -1, 0], [1, 1, 0]),
    rootPage('1', [20, -1, 0], [22, 1, 0]),
  );
  const dispose = () => [geoA, geoB, front, both].forEach((item) => item.dispose());
  return { source, ...pages, dispose };
}

/** A camera at `(x, 0, z)` looking at `(x, 0, 0)`. */
export function cameraAt(x: number, z: number) {
  const cam = G.perspectiveCamera(55, 1, 0.1, 100);
  cam.position.set(x, 0, z);
  cam.lookAt(x, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}
