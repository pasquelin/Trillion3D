import * as G from '../../host/graph/graph.fixture.ts'
import { packDagSelection } from './selection.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'

/** Nine placements of a four-level primitive on a grid, packed, and an eye over them: the scene
 *  the cut's growth and share tests cut. */
export function gridScene() {
  const roots = sceneRoots(
    scenePages(256, 4),
    Array.from({ length: 9 }, (_, w) =>
      new G.Matrix4().setPosition((w % 3) * 6 - 6, 0, -Math.floor(w / 3) * 6),
    ),
  )
  const camera = G.perspectiveCamera(55, 16 / 9, 0.1, 400)
  camera.position.set(0, 3, 12)
  camera.lookAt(0, 0, -6)
  camera.updateMatrixWorld()
  return { roots, camera, dag: packDagSelection(roots) }
}
