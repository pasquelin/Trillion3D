// At the move: a root whose box follows it is moved on the GPU — its world goes up, the cut and the
// decode read it there (`placement/roots/rootWorlds.ts`) — and declares no box on the CPU.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { setWebgpuTransform } from './transform.ts'
import { selectionRoot, runtime, scene } from '../../gpu/core/transformShear.fixture.ts'

const moved = new Float32Array(new Matrix4().makeTranslation(4, -2, 1).elements)

test('a moved root declares no box on the CPU', () => {
  const { source, mesh, worlds } = scene()
  const root = selectionRoot(mesh, [-1, -1, -1, 1, 1, 1], worlds)
  const { rt, motions } = runtime(source, [root], worlds)
  setWebgpuTransform(rt, 'target', moved)
  assert.deepEqual(motions, [], 'no box declared on the CPU')
})
