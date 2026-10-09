// The open counts placements hold of their own, read by the kernel from the table in the readout
// (`gpu/dag/heldOpen.ts`): fifty placements of a grouped primitive, every page resident, so each
// holds counts of its own, cut on the GPU with a table holding them all and with one of two slots
// — an accelerator, which leaves a count it cannot hold at its node's: the drawn pages are the
// same, and the CPU model's.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { packed as fixturePacked } from '../../../packages/sdk-browser/src/gpu/dag/selectionHelpers.fixture.ts'
import {
  dagFixture,
  frontCamera,
} from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/gpu/dag/oracle/oracle.fixture.ts'
import { ruleResidency } from '../../../packages/sdk-browser/src/gpu/dag/readiness.fixture.ts'
import { runSelectionKernel } from './selectionKernel.ts'

test('a table of open counts too small for them cuts as one that holds them all, on the GPU', async () => {
  const [root] = fixturePacked(dagFixture()).roots
  const roots = Array.from({ length: 50 }, (_, w) => ({
    ...root,
    world: new G.Matrix4().setPosition((w % 10) * 5 - 25, 0, -Math.floor(w / 10) * 5),
  }))
  const uniforms = cameraSelectionUniforms(engineCamera(frontCamera(30)), 1, [1280, 720])
  const pack = () =>
    packedWorldsToRenderOrigin(packDagSelection(roots), roots, uniforms.cameraWorld)
  const cases = [undefined, 2].map((heldSlots) => ({
    name: heldSlots ? 'two slots' : 'every count',
    packed: pack(),
    uniforms,
    heldSlots,
  }))
  const { adapter, readings } = await runSelectionKernel(cases)
  const model = pack(),
    resident = new Uint8Array(model.pageCount).fill(1)
  const expected = evaluateDagSelectionKernel(model, uniforms, ruleResidency(model, resident))
  const counts = cases.map(({ packed }) => packed.heldOpen!.entries)
  console.log(JSON.stringify({ adapter, counts, drawn: readings.map((r) => r.drawn.length) }))
  assert.ok(
    counts[0] >= roots.length && counts[1] < counts[0],
    'the small table holds fewer counts',
  )
  assert.ok(readings[0].drawn.length > 0, 'nothing drawn')
  assert.deepEqual(readings[1].drawn, readings[0].drawn, 'the small table cuts the same')
  assert.deepEqual(
    readings[0].drawn,
    (expected.drawablePageIds ?? []).toSorted((a, b) => a - b),
  )
})
