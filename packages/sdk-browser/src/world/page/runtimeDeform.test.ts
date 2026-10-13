import test from 'node:test'
import assert from 'node:assert/strict'
import type { DrawnDeformation } from '../../../../sdk-core/src/world/geometry/drawnDeformation.ts'
import { cornerDeformation } from './runtimeDeform.ts'
import { CORNER_INFLUENCES } from '../../../../sdk-core/src/contracts/proxy.ts'

const skin = (extra: Partial<DrawnDeformation>) =>
  ({ targets: [], influences: 4, ...extra }) as unknown as DrawnDeformation

test('a rigid mesh has nothing to pose', () => {
  assert.equal(
    cornerDeformation(new Uint32Array([0]), new Uint32Array([0, 1, 2]), skin({})),
    undefined,
  )
})

test("each corner keeps its vertex's four heaviest influences, and the proxy triangle's source decides the vertex", () => {
  const joints = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  const weights = new Float32Array([0.1, 0.4, 0.2, 0.3, 1, 0, 0, 0, 0.5, 0.5, 0, 0])
  const found = cornerDeformation(
    new Uint32Array([1]),
    new Uint32Array([0, 1, 2, 2, 1, 0]),
    skin({ joints, weights }),
  )!
  assert.equal(found.targets, 0)
  // A corner without morph targets: its influences' joints, then their weights.
  const corner = 2 * CORNER_INFLUENCES
  assert.equal(found.corners.length, 3 * corner)
  // Corner 0 of the proxy's triangle 0 stands on vertex 2 of the source triangle 1: indices[3] = 2.
  assert.deepEqual([...found.corners.slice(0, 4)], [9, 10, 11, 12])
  assert.deepEqual([...found.corners.slice(4, 8)], [0.5, 0.5, 0, 0])
  // Corner 1: vertex 1, whose heaviest influence is its first.
  assert.equal(found.corners[corner], 5)
})
