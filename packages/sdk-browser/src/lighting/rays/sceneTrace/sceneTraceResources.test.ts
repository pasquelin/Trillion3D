// The scene trace's resources (`sceneTraceResources.ts`): the words of its buffers from the file and the placement count,
// made once for a file and given back when the file or the room for placements changes, the table level with the roots; the world DAG's cells are in
// `sceneTraceWorld.test.ts`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { words } from '../../../../../../tests/kit/fakeDevice/fakeBuffers.ts'
import { destroyRetired } from '../../../gpu/core/frameRetire.ts'
import { ensureSceneTrace, sceneTraceWords } from './sceneTraceResources.ts'
import { SCENE_TRACE_PARAMS } from './sceneTraceWgsl.ts'
import { CULLING, fileOf } from './sceneTraceTable.fixture.ts'

test('the buffers are sized by the file and the placements, the table with room for a power of two of them', () => {
  const file = fileOf()
  assert.deepEqual(sceneTraceWords(file, 5), { nodes: 8, triangles: 12, corners: 4, table: 4 + 16 })
  assert.deepEqual(sceneTraceWords(file, 8), sceneTraceWords(file, 5))
  assert.equal(sceneTraceWords(file, 9).table, 4 + 32)
  assert.equal(sceneTraceWords(file, 0).table, 4 + 2)
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
  const made = [trace.nodes, trace.triangles, trace.corners, trace.table, trace.params]
  assert.equal(
    trace.bytes,
    made.reduce((sum, buffer) => sum + buffer.size, 0),
  )
  assert.equal(trace.nodes.size, 8 * 4)
  assert.equal(trace.table.size, (4 + 8) * 4)
})

test('the table holds the file’s records, then the record of each placement; more placements than its room are refused', () => {
  const { device } = fakeDevice()
  const trace = ensureSceneTrace(undefined, device, fileOf(), 3).sceneTrace!
  trace.syncPlacements([{ mesh: 3, primitive: 5 }, {}, { mesh: 3, primitive: 6 }])
  const table = words((trace.table as unknown as { data: Uint8Array }).data)
  assert.deepEqual(Array.from(table.subarray(0, 7)), [7, 8, 9, 10, 2, NO_INDEX, NO_INDEX])
  assert.throws(() => trace.syncPlacements(new Array(5).fill({})), /past the table/)
})

test('the culling is written to the parameters: the mode, the switches, the view’s direction, the angle’s squared tangent, the radius the far trace begins at', () => {
  const { device } = fakeDevice()
  const trace = ensureSceneTrace(undefined, device, fileOf(), 3).sceneTrace!
  const view = {
    eye: [0, 0, 0],
    treeRoot: 0,
    maxIterations: 1,
    skipBackFaceDistance: 0,
    skipTwoSidedDistance: 0,
    skipsTranslucentSections: true,
  } as const
  const P = SCENE_TRACE_PARAMS.at
  const read = () => {
    const bytes = (trace.params as unknown as { data: Uint8Array }).data
    return { word: words(bytes), float: new Float32Array(bytes.buffer, bytes.byteOffset) }
  }
  trace.writeParams({ ...view, culling: CULLING })
  let { word, float } = read()
  assert.deepEqual([word[P.cullMode], word[P.cullFlags], word[P.cullWord]], [3, 7, 4 + 4])
  assert.deepEqual(Array.from(float.subarray(P.viewDirection, P.viewDirection + 3)), [0, 0, -1])
  assert.equal(float[P.cullRadius], 300)
  assert.ok(Math.abs(float[P.culledTanAngleSq] - Math.tan(Math.PI / 180) ** 2) < 1e-9)
  // The angle is held under 89.99 degrees; the switches are bits; with no culling the far trace begins nowhere.
  trace.writeParams({
    ...view,
    culling: {
      ...CULLING,
      mode: 0,
      angle: 120,
      useDistanceToBox: false,
      useMinDrawDistance: false,
      viewDistanceScale: 0.5,
      instanceDrawDistance: false,
    },
  })
  ;({ word, float } = read())
  assert.deepEqual([word[P.cullMode], word[P.cullFlags]], [0, 0])
  assert.equal(float[P.viewDistanceScale], 0.5)
  assert.equal(
    word[P.skipsTranslucentSections],
    1,
    'the translucent primitives are left out of the rays that ask it',
  )
  assert.equal(float[P.cullRadius], 3.4028234663852886e38)
  assert.ok(Math.abs(float[P.culledTanAngleSq] / Math.tan(89.99 * (Math.PI / 180)) ** 2 - 1) < 1e-5)
  trace.writeParams({ ...view, skipsTranslucentSections: false, culling: CULLING })
  ;({ word, float } = read())
  assert.equal(word[P.skipsTranslucentSections], 0, 'the test off: they are met as opaque ones')
})
