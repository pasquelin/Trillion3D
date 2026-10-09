// A cut's queues and lists hold a view's reach, never the world's (`queueGrowth.ts`): a cut that
// passes one drops the work past it, is not drawn and never adopted — the frame draws the last cut
// that ran whole —, and what was full grows until the cut runs whole, the cut the flat tables give.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
import { kernelUniforms } from './selectionHelpers.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'
import { ruleResidency } from './readiness.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import type { GpuSelection } from '../core/selection.ts'

/** Nine placements of a four-level primitive on a grid, every page resident, and an eye over
 *  them. */
function scene() {
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

/** The pages the mask the frame draws holds (`dagCommitMask`), ascending. */
function maskPages(selection: GpuSelection, pageCount: number) {
  const { data } = selection.maskBuffer as unknown as { data: Uint8Array }
  const words = new Uint32Array(data.buffer).subarray(selection.maskOffset!)
  return Array.from({ length: pageCount }, (_, id) => id).filter(
    (id) => (words[id >>> 5] & (1 << (id & 31))) !== 0,
  )
}

/** Lets the readbacks in flight land, without the drain that would grow the tables. */
const landed = async () => {
  for (let k = 0; k < 8; k++) await new Promise((resolve) => setTimeout(resolve, 0))
}

test('a full queue costs no image: the overflowed cut is not adopted, then the tables grow to the flat cut', async () => {
  installGpuGlobals()
  const { roots, camera, dag } = scene()
  const resident = new Uint32Array(dag.pageCount).fill(1)
  const coarse = kernelUniforms(dag, roots, camera, 4),
    fine = kernelUniforms(dag, roots, camera, 0.5)
  const flat = (uniforms: typeof fine) =>
    evaluateDagSelectionKernel(dag, uniforms, ruleResidency(dag, resident))
  const [a, b] = [flat(coarse), flat(fine)]
  // Queues and lists the coarse cut fits in and the fine one passes, both.
  const queue = Math.max(...a.work.levels),
    list = Math.max(a.work.candidates, a.work.live)
  assert.ok(Math.max(...b.work.levels) > queue && b.work.candidates > list, 'the fine cut passes')
  Object.assign(dag, { queueEntries: queue, candCount: list })
  const selection = (await createGpuDagSelection(mockDagDevice(dag).device, dag))!
  selection.updateResidency(resident)
  selection.dispatch(coarse)
  const drawnA = (await selection.flush())?.drawablePageIds?.slice().sort((x, y) => x - y)
  assert.deepEqual(
    drawnA,
    a.drawablePageIds?.slice().sort((x, y) => x - y),
    'the coarse cut',
  )
  assert.ok(drawnA!.length > 0, 'a cut that draws nothing proves nothing')
  assert.deepEqual(maskPages(selection, dag.pageCount), drawnA)
  // The fine cut passes its queues and lists: not adopted, and the frame draws the coarse cut.
  selection.dispatch(fine)
  await landed()
  assert.equal(
    selection.peek()?.uniforms.pixelError,
    coarse.pixelError,
    'the overflowed cut is never adopted',
  )
  assert.deepEqual(maskPages(selection, dag.pageCount), drawnA, 'the image is the last good cut')
  // The drain grows what was full and cuts again: the flat tables' cut, page for page.
  const drawnB = (await selection.flush())?.drawablePageIds?.slice().sort((x, y) => x - y)
  assert.equal(selection.peek()?.uniforms.pixelError, fine.pixelError)
  assert.deepEqual(
    drawnB,
    b.drawablePageIds?.slice().sort((x, y) => x - y),
    'the flat cut',
  )
  assert.deepEqual(maskPages(selection, dag.pageCount), drawnB)
  selection.dispose()
})
