// Top-down pruning removes work, never pages: the shipped kernel against the same text whose
// `floorPrunes` always answers false, on the same scene, cameras and threshold. The pages kept
// must be identical — pruning only drops subtrees no cluster of which is fine enough — and the
// descent must list fewer candidates: the work the five passes after it no longer walk.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/gpu/dag/shader/shader.ts'
import {
  scenePages,
  sceneRoots,
} from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts'
import { runSelectionKernel } from './selectionKernel.ts'
import { posedSelection } from './selectionCase.ts'

const VIEWPORT: [number, number] = [1280, 720]
/** Name, camera x and z, threshold in pixels. */
const POSES: Array<[string, number, number, number]> = [
  ['head-on', 0, 16, 1],
  ['oblique', 9, 14, 1],
  ['from afar', 0, 60, 1],
  ['up close', 1.5, 3, 1],
]
/** Pruning's sole guard: disarmed, the descent walks every subtree. */
const GUARD =
  'fn floorPrunes(open:u32,sphere:vec4f,error:f32,e:mat4x4f,stretch:f32,focal:f32)->bool{\n'

test('pruning drops candidates and keeps exactly the same pages', async () => {
  assert.ok(DAG_SELECTION_SHADER.includes(GUARD), 'the `floorPrunes` guard has changed shape')
  const unpruned = DAG_SELECTION_SHADER.replace(GUARD, `${GUARD} return false;\n`)
  const pages = scenePages(2048, 8)
  const camera = G.perspectiveCamera(55, VIEWPORT[0] / VIEWPORT[1], 0.1, 200)
  const cases = POSES.map(([name, x, z, threshold]) => {
    const roots = sceneRoots(
      pages,
      Array.from({ length: 4 }, (_, w) =>
        new G.Matrix4().makeTranslation((w % 2) * 6.5 - 3.25, Math.floor(w / 2) * 6.5 - 3.25, 0),
      ),
      true,
    )
    const { packed, uniforms } = posedSelection(camera, [x, z, threshold], VIEWPORT, roots)
    return { name, packed, uniforms }
  })
  const pruned = await runSelectionKernel(cases)
  const plain = await runSelectionKernel(cases, unpruned)
  const rows = cases.map(({ name }, k) => {
    const [a, b] = [pruned.readings[k], plain.readings[k]]
    return { name, kept: a.pages, keptUnpruned: b.pages, candidates: [b.candidates, a.candidates] }
  })
  console.log(
    JSON.stringify({
      adapter: pruned.adapter,
      pages: cases[0].packed.pageCount,
      rows: rows.map(({ name, kept, candidates }) => ({ name, kept: kept.length, candidates })),
    }),
  )
  for (const { name, kept, keptUnpruned, candidates } of rows) {
    assert.deepEqual(kept, keptUnpruned, `${name}: pruning changes the cut`)
    assert.ok(candidates[1] < candidates[0], `${name}: nothing pruned`)
  }
})
