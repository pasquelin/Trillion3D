// The scene trace's resources (`sceneTraceResources.ts`): the words of its buffers from the file and the placement count,
// made once for a file and given back when the file or the room for placements changes, the table level with the roots; the world DAG's cells are in
// `sceneTraceWorld.test.ts`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { words } from '../../../../../../tests/kit/fakeDevice/fakeBuffers.ts'
import { destroyRetired } from '../../../gpu/core/frameRetire.ts'
import { createMaskHold, isReady } from './sceneMaskHold.ts'
import { ensureSceneTrace, sceneTraceWords } from './sceneTraceResources.ts'
import { SCENE_TRACE_PARAMS } from './sceneTraceWgsl.ts'
import {
  TRACED_MATERIAL_AT,
  TRACED_MATERIAL_WORDS,
} from '../../reflections/translucency/materialWords.ts'
import { CULLING, ensureTrace, fileOf, testHold } from './sceneTraceTable.fixture.ts'

const VIEW = {
  eye: [0, 0, 0],
  treeRoot: 0,
  maxIterations: 1,
  skipBackFaceDistance: 0,
  skipTwoSidedDistance: 0,
  skipsTranslucentSections: true,
  excludesSky: true,
} as const

/** The words the table holds for each placement it has room for: its record, its culling word and its material. */
const PLACEMENT_WORDS = 2 + TRACED_MATERIAL_WORDS

test('the buffers are sized by the file and the placements, the table with room for a power of two of them', () => {
  const file = fileOf()
  assert.deepEqual(sceneTraceWords(file, 5), {
    geometry: 8 + 12,
    table: 4 + 8 * PLACEMENT_WORDS,
  })
  assert.deepEqual(sceneTraceWords(file, 8), sceneTraceWords(file, 5))
  assert.equal(sceneTraceWords(file, 9).table, 4 + 16 * PLACEMENT_WORDS)
  assert.equal(sceneTraceWords(file, 0).table, 4 + PLACEMENT_WORDS)
})

test('the triangles begin on a vec4u past the nodes, which are padded to one; the table holds the corners’ attributes then the cutout coordinates right after the records', (t) => {
  const hold = testHold(t)
  const file = {
    ...fileOf(),
    nodes: new Uint32Array(6),
    triangles: new Uint32Array(5),
    corners: new Uint32Array(8),
    maskCorners: new Uint32Array(4),
  }
  const sized = sceneTraceWords(file, 1)
  assert.deepEqual([sized.geometry, sized.table], [(2 + 2) * 4, 4 + 8 + 4 + PLACEMENT_WORDS])
  // The corners come before what the placements resize: their words do not move with the room for placements.
  const { device } = fakeDevice()
  for (const placements of [1, 9]) {
    const trace = ensureTrace(hold, undefined, device, file, placements).sceneTrace!
    trace.writeParams({ ...VIEW, culling: CULLING })
    const bytes = (trace.params as unknown as { data: Uint8Array }).data
    assert.deepEqual(
      [
        words(bytes)[SCENE_TRACE_PARAMS.at.cornerWord],
        words(bytes)[SCENE_TRACE_PARAMS.at.maskWord],
      ],
      [4, 12],
    )
  }
})

test('the HLOD actors’ materials come after the file’s records; an actor’s cutout is written by its rank, and the revision counts the cutouts alone', (t) => {
  const hold = testHold(t)
  const { device } = fakeDevice()
  const file = { ...fileOf(), actorRanks: 2 }
  const trace = ensureTrace(hold, undefined, device, file, 3).sceneTrace!
  trace.writeParams({ ...VIEW, culling: CULLING })
  const bytes = (trace.params as unknown as { data: Uint8Array }).data
  const P = SCENE_TRACE_PARAMS.at
  assert.equal(words(bytes)[P.actorWord], 4, 'right after the records')
  assert.equal(words(bytes)[P.placementWord], 4 + 2 * TRACED_MATERIAL_WORDS)
  const surface = {
    baseColor: [1, 1, 1],
    metalness: 0,
    roughness: 0.5,
    emissive: [0, 0, 0],
    opacity: 1,
  }
  const cut = { cut: 0.5, map: 9, flags: 1 }
  const actors = [{}, { worn: { surface } }]
  trace.syncPlacements([], undefined, [], () => cut, actors)
  const table = words((trace.table as unknown as { data: Uint8Array }).data)
  const second = 4 + TRACED_MATERIAL_WORDS
  assert.deepEqual(
    [table[second + TRACED_MATERIAL_AT.map], table[second + TRACED_MATERIAL_AT.mask]],
    [9, 1],
    'the cutout of the actor of rank 1',
  )
  assert.equal(table[4 + TRACED_MATERIAL_AT.mask], 0, 'the actor of rank 0 wears none: no cutout')
  const revision = trace.cutoutRevision()
  const recoloured = [{}, { worn: { surface: { ...surface, baseColor: [0, 0, 1] } } }]
  trace.syncPlacements([], undefined, [], () => cut, recoloured)
  assert.equal(trace.cutoutRevision(), revision, 'a colour that moved is no cutout')
  trace.syncPlacements([], undefined, [], () => ({ ...cut, cut: 0.25 }), recoloured)
  assert.ok(trace.cutoutRevision() > revision, 'a threshold that moved is')
})

test('the cutout revision is never the same in two traces, so a trace made again for a grown capacity restarts what held the old one', (t) => {
  const hold = testHold(t)
  const { device } = fakeDevice()
  const file = fileOf()
  const first = ensureTrace(hold, undefined, device, file, 3).sceneTrace!
  const grown = ensureTrace(hold, first, device, file, 5).sceneTrace!
  assert.ok(grown.cutoutRevision() > first.cutoutRevision(), 'the later trace counts on')
})

test('the scene trace is made once for a file and kept while its table has room; outgrown or for another file it is made again, the old one retired', (t) => {
  const hold = testHold(t)
  const { device, destroyed } = fakeDevice()
  const file = fileOf()
  const first = ensureTrace(hold, undefined, device, file, 3).sceneTrace!
  assert.equal(first.capacity, 4)
  assert.equal(ensureTrace(hold, first, device, file, 4).sceneTrace, first, 'room: kept')
  const grown = ensureTrace(hold, first, device, file, 5).sceneTrace!
  assert.notEqual(grown, first)
  assert.equal(grown.capacity, 8)
  assert.ok(!destroyed.includes(first.table), 'not destroyed at once: the image may name it')
  destroyRetired(device)
  assert.ok(destroyed.includes(first.table) && destroyed.includes(first.geometry))
  assert.ok(!destroyed.includes(grown.table))
  assert.notEqual(ensureTrace(hold, grown, device, fileOf(), 5).sceneTrace, grown, 'another file')
})

test('the bytes are the buffers’, counted before they are made', (t) => {
  const hold = testHold(t)
  const { device } = fakeDevice()
  const file = fileOf()
  const trace = ensureTrace(hold, undefined, device, file, 3).sceneTrace!
  const made = [trace.geometry, trace.table, trace.params]
  assert.equal(
    trace.bytes,
    made.reduce((sum, buffer) => sum + buffer.size, 0),
  )
  assert.equal(trace.geometry.size, (8 + 12) * 4)
  assert.equal(trace.table.size, (4 + 4 * PLACEMENT_WORDS) * 4)
})

test('the table holds the file’s records, then the record of each placement; more placements than its room are refused', (t) => {
  const hold = testHold(t)
  const { device } = fakeDevice()
  const trace = ensureTrace(hold, undefined, device, fileOf(), 3).sceneTrace!
  trace.syncPlacements([{ mesh: 3, primitive: 5 }, {}, { mesh: 3, primitive: 6 }])
  const table = words((trace.table as unknown as { data: Uint8Array }).data)
  assert.deepEqual(Array.from(table.subarray(0, 7)), [7, 8, 9, 10, 2, NO_INDEX, NO_INDEX])
  assert.throws(() => trace.syncPlacements(new Array(5).fill({})), /past the table/)
})

test('the table ends with the material of each placement, where the parameters say it begins: the grey of a placement that wears none, the surface’s words of one that does', (t) => {
  const hold = testHold(t)
  const { device } = fakeDevice()
  const trace = ensureTrace(hold, undefined, device, fileOf(), 3).sceneTrace!
  const surface = {
    baseColor: [1, 0, 0],
    metalness: 0,
    roughness: 0.5,
    emissive: [0, 0, 0],
    opacity: 0.25,
    transparent: true,
  }
  trace.syncPlacements([{ mesh: 3, primitive: 5, worn: { surface } }, {}])
  const table = words((trace.table as unknown as { data: Uint8Array }).data)
  const floats = new Float32Array(table.buffer, table.byteOffset, table.length)
  // The records (4), then the placements' records and culling words (capacity 4 each).
  const first = 4 + 2 * trace.capacity
  assert.equal(floats[first + 3], 0.25, 'the first placement’s opacity')
  assert.equal(floats[first + TRACED_MATERIAL_WORDS + 3], 1, 'the second wears none: opaque')
  assert.equal(floats[first + TRACED_MATERIAL_WORDS], 0.5, 'and grey')
})

test('the culling is written to the parameters: the mode, the switches, the view’s direction, the angle’s squared tangent, the radius the far trace begins at', (t) => {
  const hold = testHold(t)
  const { device } = fakeDevice()
  const trace = ensureTrace(hold, undefined, device, fileOf(), 3).sceneTrace!
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
  ;({ word } = read())
  assert.equal(word[P.skipsTranslucentSections], 0, 'the test off: they are met as opaque ones')
})

test('the material words are not made again while the surfaces stand at their versions and the cutouts’ stamp stands', (t) => {
  const hold = testHold(t)
  const { device } = fakeDevice()
  const trace = ensureTrace(hold, undefined, device, fileOf(), 3).sceneTrace!
  const surface = {
    baseColor: [1, 0, 0],
    metalness: 0,
    roughness: 0.5,
    emissive: [0, 0, 0],
    opacity: 0.25,
    version: 1,
  }
  const root = { mesh: 3, primitive: 5, worn: { surface } }
  const opacityOf = () => {
    const table = words((trace.table as unknown as { data: Uint8Array }).data)
    return new Float32Array(table.buffer, table.byteOffset, table.length)[
      4 + 2 * trace.capacity + 3
    ]
  }
  const mask = Object.assign(() => undefined, { stamp: [1] as readonly unknown[] })
  trace.syncPlacements([root], undefined, [root], mask)
  assert.equal(opacityOf(), 0.25)
  surface.opacity = 0.5
  trace.syncPlacements([root], undefined, [root], mask)
  assert.equal(opacityOf(), 0.25, 'the version stands: the words stand')
  surface.version = 2
  trace.syncPlacements([root], undefined, [root], mask)
  assert.equal(opacityOf(), 0.5, 'the version moved: made again')
  surface.opacity = 0.75
  trace.syncPlacements(
    [root],
    undefined,
    [root],
    Object.assign(() => undefined, { stamp: [2] }),
  )
  assert.equal(opacityOf(), 0.75, 'the stamp moved: made again')
  surface.opacity = 1
  trace.syncPlacements([root], undefined, [root], () => undefined)
  assert.equal(opacityOf(), 1, 'a reader without a stamp is asked every time')
})

test('a trace is made over the hold of its owner, which a trace made again and a trace given back leave alone', () => {
  const { device } = fakeDevice()
  const file = fileOf()
  const hold = createMaskHold()
  const first = ensureSceneTrace(undefined, device, file, 3, undefined, hold).sceneTrace!
  assert.equal(first.maskHold, hold)
  const grown = ensureSceneTrace(first, device, file, 5, undefined, hold).sceneTrace!
  assert.notEqual(grown, first)
  assert.equal(grown.maskHold, hold, 'the owner keeps one hold across the traces')
  grown.dispose()
  assert.equal(
    hold.use('pass', '', () => ({ ready: true }), isReady)?.kernel.ready,
    true,
    'the trace given back does not drop the hold: its owner does',
  )
})
