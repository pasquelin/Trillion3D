// A growth of the float pool places the whole-copy table again after the wider vertices
// (`prepareWebgpuGeometry`, #1293): the table it replaces is freed, never left on the device.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { prepareWebgpuGeometry } from './geometryPrepare.ts'
import type { PageRec } from '../../page/selection/selection.ts'

test('a growth frees the whole-copy table it replaces and hands the new one', () => {
  const { device } = fakeDevice()
  const made: { freed: boolean }[] = []
  const wholePool = () => ({
    placed: [],
    floats: 0,
    rows: 1,
    upload: () => {
      const table = { freed: false }
      made.push(table)
      return { table: { destroy: () => (table.freed = true) } as unknown as GPUBuffer, count: 1 }
    },
  })
  const handed: unknown[] = []
  const { vertexPool, wholeDeformation } = prepareWebgpuGeometry(
    device,
    [{ attributes: G.triangleAttributes() }] as PageRec[],
    new Map(),
    undefined,
    [],
    (growth) => handed.push(growth.wholeDeformation),
    wholePool,
  )
  assert.ok(wholeDeformation)
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
