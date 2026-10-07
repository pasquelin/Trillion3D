// At the move: a root whose box follows it declares to the shadow scheduler where it stood and
// where it stands, two boxes apart, never the room between them.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { setWebgpuTransform } from './transform.ts'
import { selectionRoot, runtime, scene } from '../../core/transformShear.fixture.ts'

const moved = new Float32Array(new G.Matrix4().makeTranslation(4, -2, 1).elements)

test('a moved root declares the box it left and the box it lands in', () => {
  const { source, mesh, worlds } = scene()
  const root = selectionRoot(mesh, [-1, -1, -1, 1, 1, 1], worlds)
  const { rt, motions } = runtime(source, [root], worlds)
  setWebgpuTransform(rt, 'target', moved)
  // The shadow scheduler hears the two boxes apart: the pages between them keep.
  assert.deepEqual(
    motions.map(({ min, max }) => [...min, ...max]),
    [
      [-1, -1, -1, 1, 1, 1],
      [3, -3, 0, 5, -1, 2],
    ],
  )
})
