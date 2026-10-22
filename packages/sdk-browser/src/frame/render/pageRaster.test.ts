import test from 'node:test'
import { MANIFEST_IDENTITY } from '../../session/engine/pagesEngine.fixture.ts'
import assert from 'node:assert/strict'
import { isDrawnNode } from '../../scene/host/graph/kinds.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import {
  drawnPageIds,
  indirectDraws,
  installGpuGlobals,
} from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND, dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  quadScene,
  camera,
  mixedBinScene,
  quadBackend,
  flushedGpuScene,
} from '../backend/testScenes.fixture.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import {
  TESS_UNIFORM,
  fitCapacity,
  recordRoom,
  tessLayout,
  writeTessellationUniform,
} from '../../visibility/tessellation/uniform.ts'
import { warmDisplacements } from '../../visibility/tessellation/warm.ts'
import { rasterOf } from '../../visibility/raster/rasterFrame.fixture.ts'
import { OCCLUSION_NONE, PASS_DISPATCH_WORDS } from '../../visibility/tessellation/contract.ts'
import { DISPLACEMENT_WORDS } from '../../materials/table/displacementRecord.ts'

test('webgpu pages raster consumes the GPU cache and does not attach a mesh per visible page', async () => {
  installGpuGlobals()
  const { source, metadata, indices, associations, geometry, material } = quadScene()
  const { draws, writes, dispatches, buffers, packed, backend } = await flushedGpuScene({
    source,
    metadata,
    indices,
    draws: graphDraws(source, associations),
  })
  draws.length = 0
  dispatches.length = 0
  backend.render(camera())
  let pageMeshes = 0
  backend.scene.traverse((o) => {
    if (isDrawnNode(o)) pageMeshes++
  })
  assert.equal(pageMeshes, 0)
  assert.equal(backend.metrics().clusters, 2)
  assert.equal(backend.metrics().selectedTriangles, 2)
  assert.equal(backend.metrics().residentPages, 2)
  assert.ok(writes.length >= 2)
  // The scene has one prepared material class: what the frame composes once for the resolve (the
  // material cache), the bins of the image, then one dispatch of its bin, and no surface draw.
  assert.deepEqual(
    dispatchedEntries(dispatches).filter((entry) => /Bins$|^shade_/.test(entry)),
    [
      ...['shade_clear', 'shade_marks', 'shade_rows', 'shade_tris'],
      ...['clearBins', 'countBins', 'reserveBins', 'scatterBins', 'shade_cs'],
    ],
  )
  assert.ok(!draws.some((d) => d.entryPoint?.startsWith('shade_')))
  // The cut reaches the hardware raster through the image mask, which its indirect commands consume
  // as instances — each row twice: drawn by the main pass, then by the identifiers pass over
  // everything drawn (`encodeWebgpuVisibilityPasses`) —, and the software raster through the
  // cluster split, which bins each image's rows before either compaction reads them.
  assert.deepEqual(drawnPageIds(buffers, packed), [0, 1])
  const vis = indirectDraws(draws)
  assert.equal(
    vis.reduce((n, d) => n + (d.instanceCount ?? 0), 0),
    2 * 2,
  )
  assert.equal(dispatchedEntries(dispatches).includes('bin'), true)
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

test('vis drawIndirect consumes GPU instance indices against one unsorted page table', async () => {
  installGpuGlobals()
  const {
    source,
    metadata: metadataPartial,
    indices,
    associations,
    geoA,
    geoB,
    front,
    both,
  } = mixedBinScene()
  const metadata: ClusterManifest = { ...metadataPartial, ...MANIFEST_IDENTITY }
  const { draws, dispatches, buffers, packed, backend } = await flushedGpuScene({
    source,
    metadata,
    indices,
    draws: graphDraws(source, associations),
  })
  draws.length = 0
  dispatches.length = 0
  backend.render(camera())
  // The two bins — front-only and double-sided — hold two indirect commands on a shared page
  // table, and read the SAME image mask.
  assert.deepEqual(drawnPageIds(buffers, packed), [0, 1])
  // The cluster split bins the rows of every image, whichever raster draws them.
  assert.equal(dispatchedEntries(dispatches).includes('bin'), true)
  const vis = indirectDraws(draws)
  assert.ok(vis.length >= 2)
  assert.equal(
    vis.reduce((n, draw) => n + (draw.instanceCount ?? 0), 0),
    2 * 2,
    'each row drawn by the main pass, then by the identifiers pass',
  )
  assert.deepEqual([...new Set(vis.map((draw) => draw.bindOffset ?? 0))], [0])
  assert.ok(vis.every((draw) => draw.instanceBuffer && draw.groupsBuffer))
  backend.dispose()
  geoA.dispose()
  geoB.dispose()
  front.dispose()
  both.dispose()
})

// Root pages stay resident beside the streaming slots: a page cap under root coverage bounds the
// streaming slots alone, and the image is complete — never refused. The quad's two root pages and
// its one streaming slot pass the scene's two pages: the pool is the scene's, by name.
test('a page cap under root coverage keeps the cover beside it, and the image prepares', async () => {
  installGpuGlobals()
  const { device } = fakeDevice(BACKEND)
  const { fixture, backend } = quadBackend(device, {
    maxResidentPages: 1,
  })
  await backend.prepare()
  const metrics = backend.metrics()
  assert.equal(metrics.geometryPoolClamp, 'scene')
  assert.ok((metrics.geometryPoolSlots ?? 0) > 1, 'the slots hold root coverage')
  assert.equal(metrics.coverageReady, true)
  backend.dispose()
  fixture.geometry.dispose()
  fixture.material.dispose()
})

test('the uniform carries the view’s pixels per unit over the threshold, the pass’s regions and the capacity', () => {
  const floats = new Float32Array(TESS_UNIFORM.words),
    ints = new Uint32Array(floats.buffer),
    at = TESS_UNIFORM.at
  const settings = { tessellationDicingRate: 2, tessellationMaxPatchesPerGroup: 5 }
  const capacity = { candidate: 700, visible: 300, records: 192 }
  const regions = { args: 11, queue: 22, visible: 33, dispatch: 8, disp: 44 }
  const sight = {
    mode: 1,
    prevViewProj: Array.from({ length: 16 }, (_, i) => i + 1),
    depthMap: [0.1, 0.2],
    prevDepthMap: [0.3, 0.4],
    prevSize: [640, 360],
    maxOccluded: 90,
    mainArgs: 5,
  }
  writeTessellationUniform(
    floats,
    ints,
    { projection: 2, height: 1080, threshold: 1 },
    settings,
    capacity,
    regions,
    sight,
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
    [ints[at.args], ints[at.queue], ints[at.visible], ints[at.dispatch], ints[at.dispBase]],
    [11, 22, 33, 8, 44],
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
  writeTessellationUniform(
    floats,
    ints,
    { projection: 2, height: 1080, threshold: 4 },
    { ...settings, tessellationMaxPatchesPerGroup: 50 },
    capacity,
    regions,
    sight,
  )
  assert.deepEqual(
    [floats[at.edgesPerUnit], floats[at.piecesPerEdge], ints[at.patchesPerGroup]],
    [270, 2, 21],
  )
  // A threshold that is no number above zero is one pixel.
  writeTessellationUniform(
    floats,
    ints,
    { projection: 2, height: 1080, threshold: 0 },
    settings,
    capacity,
    regions,
    sight,
  )
  assert.equal(floats[at.edgesPerUnit], 1080)
})

test('the buffer lays the table, the records, the chains’ state, the queue and the lists in order, and fits the device’s limit', () => {
  const layout = tessLayout(1000, 256, 64, 32)
  assert.equal(layout.disp, 1000)
  // The cut's two passes and the shadow maps' chain each have their state; the shadow maps' patches
  // lie in the first pass's list.
  assert.deepEqual(layout.args, [1256, 1264, 1272])
  assert.equal(layout.queue, 1280)
  assert.deepEqual(layout.visible, [1280 + 64 * 4, 1280 + 64 * 4 + 32 * 4, 1280 + 64 * 4])
  assert.equal(layout.words, 1280 + 64 * 4 + 2 * 32 * 4)
  // The records have room for their words, a power of two, sixteen at least.
  assert.equal(recordRoom(0), 16 * DISPLACEMENT_WORDS)
  assert.equal(recordRoom(16 * DISPLACEMENT_WORDS + 1), 2 * 16 * DISPLACEMENT_WORDS)
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

test('the shadow maps’ chain has a state, a uniform and dispatches of its own, its patches in the first pass’s list', () => {
  const { f, device, raster } = rasterOf(true)
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  const { shadow } = raster.tessellation!
  const { layout, tess, uniforms } = shadow.resources
  const settings = { tessellationDicingRate: 2, tessellationMaxPatchesPerGroup: 5 }
  const records = (version: number) => ({ ints: new Uint32Array(24), version })
  const sentRecords = () =>
    f.writes.filter((w) => w.buffer === (tess as unknown) && w.offset === layout.disp * 4).length
  shadow.prepare(records(1), settings, 2)
  shadow.prepare(records(1), settings, 2)
  assert.equal(sentRecords(), 1, 'the records go up with the table’s version, once')
  shadow.prepare(records(2), settings, 2)
  assert.equal(sentRecords(), 2)
  // Its uniform: the third chain’s state, the queue the passes share, the first pass’s list, its
  // own dispatches; the threshold and the dicing rate of the image, no pyramid to test against.
  const sent = f.writes.filter((w) => w.buffer === (uniforms[2] as unknown)).at(-1)!
  const ints = new Uint32Array(sent.data.buffer, sent.data.byteOffset, TESS_UNIFORM.words)
  const floats = new Float32Array(ints.buffer, ints.byteOffset, TESS_UNIFORM.words)
  const at = TESS_UNIFORM.at
  assert.deepEqual(
    [ints[at.args], ints[at.queue], ints[at.visible], ints[at.dispatch], ints[at.dispBase]],
    [layout.args[2], layout.queue, layout.visible[0], 2 * PASS_DISPATCH_WORDS, layout.disp],
  )
  assert.deepEqual(
    [
      floats[at.edgesPerUnit],
      floats[at.piecesPerEdge],
      floats[at.edgesPerPixel],
      ints[at.occlusion],
    ],
    [0, 1, 0.5, OCCLUSION_NONE],
  )
  assert.equal(layout.visible[2], layout.visible[0])
  // Its state alone is cleared before a chunk: eight words at its own place.
  const encoder = device.createCommandEncoder()
  shadow.clear(encoder)
  assert.deepEqual(
    f.clears.filter((c) => c.buffer === (tess as unknown)).map((c) => [c.offset, c.size]),
    [[layout.args[2] * 4, 32]],
  )
})
