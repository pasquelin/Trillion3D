// A generated field of placements for the placement tree's proofs: one primitive (the DAG fixture's
// four-leaf strip) laid `side`² times on a square grid `gap` metres apart, rows in rank order, so
// consecutive ranks lie side by side as a partition's cell lays them. Cameras look over it.
import * as G from '../../../scene/host/graph/graph.fixture.ts'
import { collectClusterPages } from '../../selection/collect.ts'
import { dagFixture } from '../../selection/dag.fixture.ts'
import type { DagRoot } from '../types.ts'
import { packDagSelection } from '../pack/pack.ts'
import { kernelUniforms } from '../selection/selectionHelpers.fixture.ts'
import { evaluateDagSelectionKernel } from '../oracle/oracle.fixture.ts'
import { dagOracleDescent } from '../oracle/descent.fixture.ts'
import { dagViewFrames } from '../oracle/math.fixture.ts'
import { refitTree } from '../tree/treeRefitRun.fixture.ts'
import { graphDraws } from '../../selection/drawSource.ts'

/** `side`² placements of the strip, `gap` apart on x and z, the first at the origin. A view has no
 *  far plane, so a far world bounds nothing of what it holds: with `drawn`, each placement is drawn
 *  within that many metres of the eye (`DagRoot.drawDistance`), as an object names its own. */
export function placementField(side: number, gap: number, drawn?: number) {
  const fixture = dagFixture()
  const [root] = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  ).roots
  const roots: DagRoot[] = []
  for (let k = 0; k < side * side; k++) {
    const elements = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    elements[12] = (k % side) * gap
    elements[14] = -Math.floor(k / side) * gap
    roots.push({
      ...root,
      world: { elements },
      ...(drawn && { drawDistance: { min: 0, max: drawn, perInstance: false } }),
    } as DagRoot)
  }
  return roots
}

/** A camera at `eye` looking at `at`; its `far` bounds nothing of the cut (`placementField`'s `drawn` does). */
export function fieldCamera(eye: number[], at: number[], far = 400) {
  const cam = G.perspectiveCamera(55, 16 / 9, 0.1, far)
  cam.position.set(eye[0], eye[1], eye[2])
  cam.lookAt(at[0], at[1], at[2])
  cam.updateMatrixWorld()
  return cam
}

const fitted = new WeakSet<object>()
function fitOnce(dag: ReturnType<typeof packDagSelection>) {
  if (fitted.has(dag)) return
  fitted.add(dag)
  refitTree(dag)
}

/** The cut the oracle draws over `roots` under `camera`, packed with its tree or without one, and
 *  the placements whose root the descent reached: what a frame prepares. */
export function fieldCut(
  roots: DagRoot[],
  camera: ReturnType<typeof fieldCamera>,
  tree: boolean,
  dag = packDagSelection(roots),
) {
  // The pack leaves the tree open: its first fit is the refit's (`../tree/treeRefitRun.fixture.ts`).
  if (tree && dag.placementTree) fitOnce(dag)
  const packed = tree ? dag : { ...dag, placementTree: undefined }
  const uniforms = kernelUniforms(packed, roots, camera, 1)
  const result = evaluateDagSelectionKernel(packed, uniforms)
  const flags = dagOracleDescent(packed, dagViewFrames(packed, uniforms))
  const placements: number[] = []
  for (let w = 0; w < roots.length; w++) if (flags.reached(w)) placements.push(w)
  const reached = placements.length
  return {
    ...{ pages: result.pageIds, drawn: result.drawablePageIds ?? [], reached, placements, dag },
    // The entries each level of the descent holds (`dagOracleDescent`, `work.levels`).
    levels: flags.work.levels,
  }
}
