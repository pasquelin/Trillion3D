// At the move: a root whose box follows it has its rows derived again, their shadow change asked —
// the rows pass stales the pages each row left and entered (`placement/rowCastWgsl.ts`) —, and
// declares no box on the CPU.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { setWebgpuTransform } from './transform.ts'
import { selectionRoot, runtime, scene } from '../../core/transformShear.fixture.ts'

const moved = new Float32Array(new G.Matrix4().makeTranslation(4, -2, 1).elements)

test("a moved root asks its rows' shadow change, and declares no box", () => {
  const { source, mesh, worlds } = scene()
  const root = selectionRoot(mesh, [-1, -1, -1, 1, 1, 1], worlds)
  const { rt, motions } = runtime(source, [root], worlds)
  setWebgpuTransform(rt, 'target', moved)
  assert.deepEqual(rt.rowWords?.roots, [0], 'its rows derived again, their change asked')
  assert.deepEqual(motions, [], 'no box declared on the CPU')
})
