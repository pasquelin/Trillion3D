// A growth of the float pool places the pooled blocks' table again after the wider vertices
// (`prepareWebgpuGeometry`): the table it replaces is freed, never left on the device.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { prepareWebgpuGeometry } from './geometryPrepare.ts'
import type { PageRec } from '../../page/selection/types.ts'

test('a growth frees the pooled table it replaces and hands the new one', () => {
  const { device } = fakeDevice()
  const made: { freed: boolean }[] = []
  const pooledRows = () => ({
    floats: 0,
    rows: 1,
    upload: () => {
      const table = { freed: false }
      made.push(table)
      return { table: { destroy: () => (table.freed = true) } as unknown as GPUBuffer, count: 1 }
    },
  })
  const handed: unknown[] = []
  const { vertexPool, pooledDeformation } = prepareWebgpuGeometry(
    device,
    [{ attributes: G.triangleAttributes() }] as PageRec[],
    new Map(),
    undefined,
    (growth) => handed.push(growth.pooledDeformation),
    pooledRows,
  )
  assert.ok(pooledDeformation)
  vertexPool.place(G.triangleAttributes(), true) // past the room: the pool doubles
  assert.deepEqual(
    made.map((table) => table.freed),
    [true, false],
  )
  assert.equal(handed.length, 1)
  vertexPool.place(G.triangleAttributes(), true) // past six vertices: the pool doubles again
  assert.deepEqual(
    made.map((table) => table.freed),
    [true, true, false],
  )
  assert.equal(handed.length, 2)
})
