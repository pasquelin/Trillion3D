// The engine's own proxy over a field of cubes, its rays cast as the engine casts them: after a cut,
// which fits the placement tree first (`gpu/dag/treeFollow.ts`). A tree before its first fit holds
// the whole world in every node (`packPlacementTree`): a ray walking it opens every group and spends
// its budget on the first members of the tree's order, never reaching the rest. The session's leaves
// writer (`placement/treeLeaves.ts`) is stood in for by the leaves it writes (`leafBoxes`, proven
// word for word against it), sent once, whole.
import { walk, NEW_WALK } from './proxyWalks.ts'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { cubeCut } from '../../../packages/sdk-browser/src/bounce/runtimeScene.fixture.ts'
import { packDoubles } from '../../../packages/math/src/float/splitDouble.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import { frontCamera } from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts'
import { leafBoxes } from '../../../packages/sdk-browser/src/gpu/dag/treeRefitRun.fixture.ts'
import type { RootsOnGpu } from '../../../packages/sdk-browser/src/gpu/dag/runtime.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import {
  scenePages,
  sceneRoots,
} from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts'
import {
  createGpuDagSelection,
  packDagSelection,
} from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { surface } from '../../../packages/sdk-browser/src/gpu/dag/proxyInstances.fixture.ts'

/** `count` cubes on a field `side` wide, three metres apart, each wearing the cube's cut. */
function cubeField(count: number) {
  const side = Math.ceil(Math.sqrt(count)),
    cut = cubeCut(),
    worn = { primitive: { runtimeProxy: cut }, surface: surface(1) }
  const places = Array.from({ length: count }, (_, w) =>
    new G.Matrix4().makeTranslation((w % side) * 3, 0, Math.floor(w / side) * 3),
  )
  const roots = sceneRoots(scenePages(16, 2), places)
  roots.forEach((root) => (root.proxy = worn))
  return packDagSelection(roots)
}

/** The session's writes before a cut, on `device`: no root to write, every placement's leaf as the
 *  GPU writes it, the first time, whole. */
function leavesOf(device: GPUDevice, packed: PackedDag): RootsOnGpu {
  return {
    roots() {},
    leaves: {
      ready: () => true,
      encode(_encoder, { members }, { whole }) {
        if (!whole) return
        const leaves = leafBoxes(packed),
          words = new Uint32Array(leaves.length * 2)
        packDoubles(words, 0, leaves)
        device.queue.writeBuffer(members, 0, words)
      },
    },
  }
}

/** The engine's proxy over `count` cubes on `device`, after one cut: whether it is refused, and
 *  the hits of `cast`. */
export async function engineWalk(
  device: GPUDevice,
  count: number,
  cast: Float32Array<ArrayBuffer>,
) {
  const packed = cubeField(count)
  let refused: string | undefined
  const selection = await createGpuDagSelection(device, packed, {
    onRefused: (reason) => (refused = reason),
    roots: leavesOf(device, packed),
  })
  if (!selection) return { refused, hits: undefined }
  selection.dispatch(cameraSelectionUniforms(engineCamera(frontCamera(16, 200)), 1, [1280, 720]))
  await selection.flush()
  const proxy = selection.proxy()
  const hits =
    proxy &&
    (await walk(device, NEW_WALK, cast, {
      proxy: proxy.buffer,
      worlds: proxy.worlds,
      tree: proxy.tree,
    }))
  selection.dispose()
  return { refused, hits }
}
