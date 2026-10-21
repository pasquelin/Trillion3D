import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { packDagSelection } from './pack/pack.ts'
import { scenePages, sceneRoots } from './cut/cutFrontierScene.fixture.ts'

/** Nine placements of a four-level primitive on a grid, packed: the scene the cut's share tests
 *  make the cut of. */
export function gridScene() {
  const roots = sceneRoots(
    scenePages(256, 4),
    Array.from({ length: 9 }, (_, w) =>
      new Matrix4().setPosition((w % 3) * 6 - 6, 0, -Math.floor(w / 3) * 6),
    ),
  )
  return { dag: packDagSelection(roots) }
}
