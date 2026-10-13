// No module is prepared before the first test: the products have no path but the kernel's.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { replicateInstances } from './replicateInstances.ts'

/** A scene of one unit mesh at x = 1, and the bounds a caller prepared for it. */
function oneMesh() {
  const source = new G.Group(),
    mesh = G.mesh(G.boxGeometry(2, 1, 3), G.basicSurface())
  mesh.position.set(1, 0, 0)
  source.add(mesh)
  return { source, bounds: [0, 0, 0, 2, 1, 3] }
}

test('without the module, replication is refused by name: no loop stands in for the kernel', () => {
  const { source, bounds } = oneMesh()
  assert.throws(() => replicateInstances(source, new Map(), 4, bounds), /SDK_WASM_UNAVAILABLE/)
})

test('a lot that does not hold the copies is left as it was, the products taken in one remade at their count', async () => {
  await import('../wasm/sdkWasm.fixture.ts')
  const { createMultiplyLot } = await import('../page/decode/batch/batchRuntime.ts')
  const other = await createMultiplyLot(3)
  assert.ok(other)
  other.out.fill(7)
  for (const lot of [other, null]) {
    const { source, bounds } = oneMesh()
    const group = replicateInstances(source, new Map(), 4, bounds, lot)
    const places = group.children.map((copy) => Array.from(copy.matrixWorld.elements.slice(12, 15)))
    assert.deepEqual(places, [
      [0, 0, -1.5],
      [2, 0, -1.5],
      [0, 0, 1.5],
      [2, 0, 1.5],
    ])
  }
  assert.equal(other.holds(3), true)
  assert.ok(
    other.out.every((value) => value === 7),
    'its products untouched',
  )
  other.release()
})
