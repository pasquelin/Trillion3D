// The scene trace's resources (`sceneTraceResources.ts`): the words of its buffers from the file and the placement count,
// made once for a file and given back when the file or the room for placements changes, the table level with the roots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import type { RayTracing } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { words } from '../../../../../../tests/kit/fakeDevice/fakeBuffers.ts'
import { destroyRetired } from '../../../gpu/core/frameRetire.ts'
import { ensureSceneTrace, sceneTraceWords } from './sceneTraceResources.ts'

const fileOf = (): RayTracing => ({
  records: new Uint32Array([7, 8, 9, 10]),
  nodes: new Uint32Array(8).fill(1),
  triangles: new Uint32Array(12).fill(2),
  byPrimitive: new Map([[3, new Map([[5, 2]])]]),
})

test('the buffers are sized by the file and the placements, the table with room for a power of two of them', () => {
  const file = fileOf()
  assert.deepEqual(sceneTraceWords(file, 5), { nodes: 8, triangles: 12, table: 4 + 8 })
  assert.deepEqual(sceneTraceWords(file, 8), sceneTraceWords(file, 5))
  assert.equal(sceneTraceWords(file, 9).table, 4 + 16)
  assert.equal(sceneTraceWords(file, 0).table, 4 + 1)
})

test('the scene trace is made once for a file and kept while its table has room; outgrown or for another file it is made again, the old one retired', () => {
  const { device, destroyed } = fakeDevice()
  const file = fileOf()
  const first = ensureSceneTrace(undefined, device, file, 3).sceneTrace!
  assert.equal(first.capacity, 4)
  assert.equal(ensureSceneTrace(first, device, file, 4).sceneTrace, first, 'room: kept')
  const grown = ensureSceneTrace(first, device, file, 5).sceneTrace!
  assert.notEqual(grown, first)
  assert.equal(grown.capacity, 8)
  assert.ok(!destroyed.includes(first.table), 'not destroyed at once: the image may name it')
  destroyRetired(device)
  assert.ok(destroyed.includes(first.table) && destroyed.includes(first.nodes))
  assert.ok(!destroyed.includes(grown.table))
  assert.notEqual(ensureSceneTrace(grown, device, fileOf(), 5).sceneTrace, grown, 'another file')
})

test('the bytes are the buffers’, counted before they are made', () => {
  const { device } = fakeDevice()
  const file = fileOf()
  const trace = ensureSceneTrace(undefined, device, file, 3).sceneTrace!
  const made = [trace.nodes, trace.triangles, trace.table, trace.params]
  assert.equal(
    trace.bytes,
    made.reduce((sum, buffer) => sum + buffer.size, 0),
  )
  assert.equal(trace.nodes.size, 8 * 4)
  assert.equal(trace.table.size, (4 + 4) * 4)
})

test('the table holds the file’s records, then the record of each placement; more placements than its room are refused', () => {
  const { device } = fakeDevice()
  const trace = ensureSceneTrace(undefined, device, fileOf(), 3).sceneTrace!
  trace.syncPlacements([{ mesh: 3, primitive: 5 }, {}, { mesh: 3, primitive: 6 }])
  const table = words((trace.table as unknown as { data: Uint8Array }).data)
  assert.deepEqual(Array.from(table.subarray(0, 7)), [7, 8, 9, 10, 2, NO_INDEX, NO_INDEX])
  assert.throws(() => trace.syncPlacements(new Array(5).fill({})), /past the table/)
})
