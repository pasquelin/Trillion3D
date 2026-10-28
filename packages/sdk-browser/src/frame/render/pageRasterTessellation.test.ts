// The tessellation pass of the page raster: its uniform, buffer layout, shadow chains and pyramid tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TESS_UNIFORM,
  fitCapacity,
  recordRoom,
  tessLayout,
} from '../../visibility/tessellation/uniform.ts'
import { writtenUniform } from '../../visibility/tessellation/uniform.fixture.ts'
import { warmDisplacements } from '../../visibility/tessellation/warm.ts'
import { rasterOf } from '../../visibility/raster/rasterFrame.fixture.ts'
import {
  OCCLUSION_MAIN,
  OCCLUSION_NONE,
  OCCLUSION_POST,
  LOSS_WORDS,
  PASS_ARG_WORDS,
  WINDOW_WORDS,
  windowCapacity,
  PASS_DISPATCH_WORDS,
} from '../../visibility/tessellation/contract.ts'
import { DISPLACEMENT_WORDS } from '../../materials/table/displacementRecord.ts'

test('the uniform carries the view’s pixels per unit over the threshold, the pass’s regions and the capacity', () => {
  const at = TESS_UNIFORM.at
  const settings = { tessellationDicingRate: 2, tessellationMaxPatchesPerGroup: 5 }
  const capacity = { candidate: 700, visible: 300, records: 192 }
  const regions = {
    args: 11,
    queue: 22,
    visible: 33,
    occluded: 77,
    windows: 66,
    dispatch: 8,
    disp: 44,
    list: 55,
    lost: 99,
    layered: true,
  }
  const sight = {
    mode: 1,
    prevViewProj: Array.from({ length: 16 }, (_, i) => i + 1),
    depthMap: [0.1, 0.2],
    prevDepthMap: [0.3, 0.4],
    prevSize: [640, 360],
    maxOccluded: 90,
    mainArgs: 5,
  }
  const given = { settings, capacity, regions, sight }
  let { floats, ints } = writtenUniform(
    { projection: 2, height: 1080, threshold: 1, lodScale: 1 },
    given,
  )
  // 0.5 * 2 * 1080 pixels at depth one; an edge may span the threshold over the dicing rate.
  assert.deepEqual(
    [floats[at.edgesPerUnit], floats[at.piecesPerEdge], floats[at.edgesPerPixel]],
    [1080, 0.5, 1],
  )
  assert.deepEqual(
    [ints[at.patchesPerGroup], ints[at.maxCandidate], ints[at.maxVisible]],
    [5, 700, 300],
  )
  assert.deepEqual(
    [
      ints[at.args],
      ints[at.queue],
      ints[at.visible],
      ints[at.windowsAt],
      ints[at.dispatch],
      ints[at.dispBase],
    ],
    [11, 22, 33, 66, 8, 44],
  )
  assert.equal(ints[at.lost], 99, 'where the chain counts what it lost')
  assert.equal(ints[at.layered], 1, 'whether the chain keeps a visible list per layer')
  assert.equal(
    ints[at.occludedAt],
    77,
    'where the shadow maps’ chain keeps the patches the main pass hid',
  )
  // The occlusion test's: the pyramid's mode, the capacity of what it keeps, where the main pass's
  // state lies, the views' depth maps and sizes, the previous matrix whole.
  assert.deepEqual([ints[at.occlusion], ints[at.maxOccluded], ints[at.mainArgs]], [1, 90, 5])
  assert.deepEqual(
    [floats[at.depthMap], floats[at.depthMap + 1], floats[at.prevDepthMap + 1]],
    [Math.fround(0.1), Math.fround(0.2), Math.fround(0.4)],
  )
  assert.deepEqual([ints[at.prevSize], ints[at.prevSize + 1]], [640, 360])
  assert.deepEqual(
    Array.from(floats.slice(at.prevViewProj, at.prevViewProj + 16)),
    sight.prevViewProj,
  )
  // A coarser threshold lets an edge span more pixels: fewer cuts. A group takes what its threads hold.
  ;({ floats, ints } = writtenUniform(
    { projection: 2, height: 1080, threshold: 4, lodScale: 1 },
    { ...given, settings: { ...settings, tessellationMaxPatchesPerGroup: 50 } },
  ))
  assert.deepEqual(
    [floats[at.edgesPerUnit], floats[at.piecesPerEdge], ints[at.patchesPerGroup]],
    [270, 2, 21],
  )
  // A threshold that is no number above zero is one pixel.
  ;({ floats } = writtenUniform({ projection: 2, height: 1080, threshold: 0, lodScale: 1 }, given))
  assert.equal(floats[at.edgesPerUnit], 1080)
})

test('the buffer lays the table, the records, the chains’ state, the queue, the lists and the windows in order, and fits the device’s limit', () => {
  const layout = tessLayout(1000, 256, 64, 32)
  assert.equal(layout.disp, 1000)
  // The cut's two passes and the shadow maps' two chains (the main pass's and the post pass's) each have their state; the shadow maps'
  // patches lie in the first pass's list, the patches their main pass hides in the second's, and their windows follow the lists.
  const queue = 1256 + 4 * PASS_ARG_WORDS
  assert.deepEqual(layout.args, [
    1256,
    1256 + PASS_ARG_WORDS,
    1256 + 2 * PASS_ARG_WORDS,
    1256 + 3 * PASS_ARG_WORDS,
  ])
  assert.equal(layout.queue, queue)
  assert.deepEqual(layout.visible, [
    queue + 64 * 4,
    queue + 64 * 4 + 32 * 4,
    queue + 64 * 4,
    queue + 64 * 4,
  ])
  assert.equal(layout.occluded, layout.visible[1])
  assert.equal(layout.windows, queue + 64 * 4 + 2 * 32 * 4)
  assert.equal(layout.lost, layout.windows + windowCapacity(64) * WINDOW_WORDS)
  assert.equal(layout.words, layout.lost + 4 * LOSS_WORDS)
  // The records have room for their words, a power of two, sixteen at least.
  assert.equal(recordRoom(0), 16 * DISPLACEMENT_WORDS)
  // Past them the next power of two.
  const past = 16 * DISPLACEMENT_WORDS + 1
  assert.equal(recordRoom(past), 2 ** Math.ceil(Math.log2(past)))
  // What fits is kept; what does not is brought down in proportion, to a buffer that fits.
  const asked = { candidate: 2 * 1048576, visible: 2 * 1048576, records: 192 }
  assert.deepEqual(fitCapacity(134217728, 44000, asked), asked)
  const fitted = fitCapacity(64 * 1048576, 44000, asked)
  assert.ok(fitted.candidate < asked.candidate && fitted.candidate === fitted.visible)
  assert.equal(fitted.records, 192, 'the records are never brought down')
  assert.ok(
    tessLayout(44000, fitted.records, fitted.candidate, fitted.visible).words * 4 <= 64 * 1048576,
  )
  assert.ok(fitCapacity(1, 44000, asked).candidate >= 1, 'never none')
})

test('the height maps’ tiles are asked for at the level the view and the dicing rate read them at', () => {
  const asked: unknown[][] = []
  const textures = { warm: (...call: unknown[]) => (asked.push(call), true) }
  const records = new Uint32Array(3 * DISPLACEMENT_WORDS)
  records[8] = 4 // a record's map slot: its eighth word
  records[2 * DISPLACEMENT_WORDS + 8] = 9
  warmDisplacements(textures, { ints: records }, 1920, 2, 12)
  // Rank 0 and rank 1 hold no map: nothing asked for them.
  assert.deepEqual(asked, [
    ['data', 4, 960, 12],
    ['data', 9, 960, 12],
  ])
})

test('the shadow maps’ chain has a state, a uniform and dispatches of its own, its patches in the first pass’s list, the ones its main pass hides in the second’s, and its windows after the lists', () => {
  const { f, device, raster } = rasterOf(true)
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  const { shadow } = raster.tessellation!
  const { layout, tess, uniforms } = shadow.resources
  const settings = { tessellationDicingRate: 2, tessellationMaxPatchesPerGroup: 5 }
  const records = (version: number) => ({ ints: new Uint32Array(24), version })
  const sentRecords = () =>
    f.writes.filter((w) => w.buffer === (tess as unknown) && w.offset === layout.disp * 4).length
  shadow.prepare(records(1), settings, 2, 1)
  shadow.prepare(records(1), settings, 2, 1)
  assert.equal(sentRecords(), 1, 'the records go up with the table’s version, once')
  shadow.prepare(records(2), settings, 2, 0.5)
  assert.equal(sentRecords(), 2)
  // The image’s numbers wait: the uniform is written once, as the first chain of the image begins (`clear`), or with the pyramid (`sight`).
  const uniformWrites = () => f.writes.filter((w) => w.buffer === (uniforms[2] as unknown)).length
  assert.equal(uniformWrites(), 0, 'preparing writes no uniform')
  const encoder = device.createCommandEncoder()
  shadow.clear(encoder, false)
  assert.equal(uniformWrites(), 1, 'the first chain writes it')
  shadow.clear(encoder, true)
  assert.equal(uniformWrites(), 1, 'once for the image')
  // Its uniform: the third chain’s state, the queue the passes share, the first pass’s list and its
  // windows, its own dispatches; the threshold and the dicing rate of the image, no pyramid to test against.
  const sent = f.writes.filter((w) => w.buffer === (uniforms[2] as unknown)).at(-1)!
  const ints = new Uint32Array(sent.data.buffer, sent.data.byteOffset, TESS_UNIFORM.words)
  const floats = new Float32Array(ints.buffer, ints.byteOffset, TESS_UNIFORM.words)
  const at = TESS_UNIFORM.at
  assert.deepEqual(
    [
      ints[at.args],
      ints[at.queue],
      ints[at.visible],
      ints[at.windowsAt],
      ints[at.dispatch],
      ints[at.dispBase],
    ],
    [
      layout.args[2],
      layout.queue,
      layout.visible[0],
      layout.windows,
      2 * PASS_DISPATCH_WORDS,
      layout.disp,
    ],
  )
  assert.deepEqual(
    [
      floats[at.edgesPerUnit],
      floats[at.piecesPerEdge],
      floats[at.edgesPerPixel],
      ints[at.occlusion],
      floats[at.lodScale],
    ],
    [0, 1, 0.5, OCCLUSION_NONE, 0.5],
  )
  assert.equal(layout.visible[2], layout.visible[0])
  // Its state alone is cleared before a chunk: its words at its own place, the main pass's or the post pass's.
  assert.deepEqual(
    f.clears.filter((c) => c.buffer === (tess as unknown)).map((c) => [c.offset, c.size]),
    [
      [layout.args[2] * 4, PASS_ARG_WORDS * 4],
      [layout.args[3] * 4, PASS_ARG_WORDS * 4],
    ],
  )
})

test('a frame that keeps a pyramid has its shadow chains test it: the main pass the previous frame’s and keep what it hides, the post pass this frame’s, taking up the main pass’s', () => {
  const { f, device, raster } = rasterOf(true)
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  const { shadow } = raster.tessellation!
  const { layout, uniforms } = shadow.resources
  const settings = { tessellationDicingRate: 2, tessellationMaxPatchesPerGroup: 5 }
  shadow.prepare({ ints: new Uint32Array(24), version: 1 }, settings, 2, 1)
  const last = (chain: number) => {
    const sent = f.writes.filter((w) => w.buffer === (uniforms[chain] as unknown)).at(-1)!
    return new Uint32Array(sent.data.buffer, sent.data.byteOffset, TESS_UNIFORM.words)
  }
  const at = TESS_UNIFORM.at
  // Without a pyramid the chains write their uniforms as they begin, testing none.
  const encoder = device.createCommandEncoder()
  shadow.clear(encoder, false)
  assert.deepEqual([last(2)[at.occlusion], last(3)[at.occlusion]], [OCCLUSION_NONE, OCCLUSION_NONE])
  // With one, the image writes them with the pyramid's mode, in place of the first writing.
  shadow.prepare({ ints: new Uint32Array(24), version: 1 }, settings, 2, 1)
  shadow.sight()
  const [main, post] = [last(2), last(3)]
  assert.deepEqual([main[at.occlusion], post[at.occlusion]], [OCCLUSION_MAIN, OCCLUSION_POST])
  assert.deepEqual([main[at.maxOccluded], post[at.maxOccluded]], [1000, 1000])
  assert.equal(post[at.mainArgs], layout.args[2], 'the post pass reads the main pass’s count')
  assert.equal(post[at.args], layout.args[3], 'and keeps a state of its own')
  assert.equal(main[at.occludedAt], layout.occluded)
  assert.equal(layout.occluded, layout.visible[1], 'in the list the cut’s second pass would fill')
  assert.equal(main[at.maxWindows], windowCapacity(1000))
})
