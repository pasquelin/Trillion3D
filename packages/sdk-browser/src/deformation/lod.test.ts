import test from 'node:test'
import assert from 'node:assert/strict'
import { clusterPixels } from '../page/selection/math.ts'
import { drawsCluster } from '../page/cut/rule.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'

const matrix = new Matrix4().elements
const pixels = (level: number, reach: number) =>
  clusterPixels(
    {
      level,
      lodError: 0,
      parentError: 0,
      sphere: [0, 0, -100, 1],
    },
    matrix,
    1,
    500,
    0.1,
    1,
    new Float64Array(2),
    true,
    reach,
  )

test('a flat coarse rest pose refines when arbitrary deformation separates its sources', () => {
  assert.deepEqual([...pixels(1, 0)], [0, 0])
  const coarse = pixels(1, 20),
    leaf = pixels(0, 20)
  assert.ok(coarse[0] > 100)
  assert.equal(leaf[0], 0)
  assert.equal(leaf[1], coarse[0])
  assert.equal(
    drawsCluster(true, Infinity, coarse[0], false, 1),
    true,
    'keep the resident parent while finer pages stream: no hole',
  )
  assert.equal(drawsCluster(true, Infinity, coarse[0], true, 1), false)
  assert.equal(drawsCluster(true, leaf[1], leaf[0], true, 1), true)
})

test('two displacement bounds cover arbitrary source transfer, including opposite motion', () => {
  const reach = 100
  const source = -reach,
    reduced = reach
  assert.equal(Math.abs(reduced - source), 2 * reach)
  assert.equal(pixels(1, reach)[0], Infinity, 'near plane crossing requests refinement')
})
