import test from 'node:test'
import assert from 'node:assert/strict'
import { MODE_DEPTH, MODE_ID, rasterEntry } from '../../visibility/raster/contract.ts'
import { drawnPageIds, installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import {
  quadScene,
  camera,
  disposeQuadRun,
  flushedGpuScene,
} from '../backend/testScenes.fixture.ts'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { rasterOf } from '../../visibility/raster/rasterFrame.fixture.ts'
import { TESS_BINDINGS } from '../../visibility/tessellation/bindings.ts'
import { TESS_UNIFORM } from '../../visibility/tessellation/uniform.ts'
import {
  OCCLUSION_MAIN,
  OCCLUSION_NONE,
  OCCLUSION_POST,
} from '../../visibility/tessellation/contract.ts'

// Every image splits its clusters between the two rasters and writes one visibility buffer: the
// main pass's binning first, then its depth — hardware slots, software lists —, the post pass's
// when the cut runs one, then the identifiers, the hardware slots drawn again for them; the
// pyramid's level zero after each pass's depth and the closed image are full-screen resolves of
// the buffer (`resolve.ts`).
test('every image bins its clusters, writes each pass’s depth, then the identifiers', async () => {
  installGpuGlobals()
  const fixture = quadScene()
  const { draws, dispatches, buffers, packed, backend } = await flushedGpuScene(fixture)
  draws.length = 0
  dispatches.length = 0
  backend.render(camera())
  assert.deepEqual(drawnPageIds(buffers, packed), [0, 1])
  const at = (entry: string) => dispatchedEntries(dispatches).indexOf(entry)
  const bin = at('bin'),
    depth = at(rasterEntry('fine', MODE_DEPTH)),
    ids = at(rasterEntry('fine', MODE_ID))
  assert.ok(bin >= 0 && depth > bin && ids > depth)
  assert.ok(draws.some((draw) => draw.indirect))
  const resolves = draws
    .filter((draw) => draw.entryPoint === 'fullscreen')
    .map((draw) => draw.pipeline.fragment?.entryPoint)
    .filter((entry) => entry === 'depthLevel' || entry === 'resolved')
  // Level zero once a pass, the image closed once.
  assert.equal(resolves.at(-1), 'resolved')
  assert.ok(resolves.length >= 2 && resolves.slice(0, -1).every((entry) => entry === 'depthLevel'))
  disposeQuadRun(backend, fixture)
})

test('a frame that tessellates nothing allocates, compiles and dispatches nothing for it', () => {
  const { f, raster, frame } = rasterOf(false)
  raster.followTessellation(f.device as unknown as GPUDevice, undefined)
  const kernels = frame()
  assert.ok(kernels.length && kernels.every((name) => !name.startsWith('tess')), kernels.join())
  assert.ok(f.buffers.every((b) => !/tessellation|displacement/i.test(b.label ?? '')))
  assert.ok(f.computePipelines.every((p) => !p.compute.entryPoint.startsWith('tess')))
  // Its binning is the plain one: no module of it names the tessellated rows.
  assert.ok(
    f.computePipelines.every(
      (p) => !(p.compute.module as { code?: string }).code?.includes('tessellatedRow'),
    ),
  )
})

test('a frame that tessellates seeds, splits six levels and dices in both modes of both passes', async () => {
  const { f, device, raster, frame } = rasterOf(true)
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  // The frame is held while the pipelines it asked compile (`askFramePipelines`).
  await new Promise((done) => setTimeout(done, 0))
  const kernels = frame()
  const levels = Array(6).fill(['tessPlan', 'tessSplit']).flat()
  const seeding = ['bin', 'plan', 'tessSeed', ...levels, 'tessVisibleArgs']
  const classes = (mode: number) => ['fine', 'coarse', 'large'].map((klass) => `${klass}${mode}`)
  assert.deepEqual(kernels, [
    ...seeding,
    ...classes(0),
    'tessDice0',
    ...seeding,
    ...classes(1),
    ...classes(1),
    'tessDice1',
    'tessDice1',
  ])
  // The levels and the dicing launch from the dispatch buffer at the pass's own words.
  const launched = f.dispatches.filter(
    (d) => d.buffer?.label === 'Trillion3D tessellation dispatch',
  )
  assert.deepEqual(
    launched.map((d) => [d.entryPoint, d.offset]),
    [
      ...Array(6).fill(['tessSplit', 0]),
      ['tessDice0', 12],
      ...Array(6).fill(['tessSplit', 64]),
      ['tessDice1', 12],
      ['tessDice1', 76],
    ],
  )
  // The pass's state is cleared before its binning, and nothing else of the buffer.
  const states = f.clears.filter((c) => c.buffer.label === 'Trillion3D tessellation')
  assert.equal(states.length, 2)
  assert.ok(states.every((c) => c.size === 32))
  // Its binning is the one that leaves the displaced rows to it.
  const bins = f.computePipelines.filter((p) => p.compute.entryPoint === 'bin')
  assert.deepEqual(
    bins.map((p) => !!(p.compute.module as { code?: string }).code?.includes('tessellatedRow')),
    [false, false, true, true],
  )
})

test('the held tessellation is kept while its capacity stands, made again when it moves, given back with none', () => {
  const { f, device, raster, frame } = rasterOf(true)
  const made = () => f.buffers.filter((b) => b.label === 'Trillion3D tessellation').length
  const destroyed = () => f.destroyed.filter((d) => d.label === 'Trillion3D tessellation').length
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  assert.equal(made(), 1, 'one buffer for the same capacity')
  raster.followTessellation(device, { candidate: 2000, visible: 1000, records: 192 })
  assert.deepEqual([made(), destroyed()], [2, 1], 'a capacity that moved remakes it')
  // The room the displaced surfaces' records need is part of it: records past it remake the buffer.
  raster.followTessellation(device, { candidate: 2000, visible: 1000, records: 384 })
  assert.deepEqual([made(), destroyed()], [3, 2], 'records that outgrew their room remake it')
  frame()
  raster.followTessellation(device, undefined)
  assert.equal(destroyed(), 3, 'the image that tessellates nothing gives its buffers back')
})

test('a cut in two passes tests the patches against the pyramids: the main pass keeps what it hides, the post pass takes it up again', async () => {
  const { f, device, raster, frame, input } = rasterOf(true)
  const pyramid = (label: string) => ({
    view: { label } as unknown as GPUTextureView,
    levels: device.createBuffer({ label, size: 1024, usage: GPUBufferUsage.UNIFORM }),
  })
  const [previous, current] = [pyramid('previous'), pyramid('current')]
  Object.assign(input.tessellation!.occlusion, { previous, current: () => current })
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  await new Promise((done) => setTimeout(done, 0))
  const kernels = frame()
  // The post pass seeds, then queues what the main pass hid — its arguments, then a launch from the
  // dispatch buffer at the pass's own words — before its levels.
  const post = kernels.indexOf('tessSeed', kernels.indexOf('tessSeed') + 1)
  assert.deepEqual(kernels.slice(post, post + 4), [
    'tessSeed',
    'tessResumeArgs',
    'tessResume',
    'tessPlan',
  ])
  assert.equal(kernels.filter((name) => name === 'tessResume').length, 1, 'the post pass alone')
  const resumed = f.dispatches.find((d) => d.entryPoint === 'tessResume')!
  assert.equal(resumed.offset, (16 + 6) * 4)
  // What the main pass hides has a buffer as large as the queue, made once.
  const kept = f.buffers.filter((b) => b.label === 'Trillion3D tessellation occluded patches')
  assert.deepEqual(
    kept.map((b) => b.size),
    [16, 1000 * 16],
    'a stand-in, then the buffer',
  )
  // Each pass's uniform names its pyramid's mode, the capacity of what it keeps and where the main
  // pass's state lies; the split reads each pass's own pyramid and levels.
  const at = TESS_UNIFORM.at
  const sent = f.writes
    .filter((w) => (w.buffer as { label?: string }).label === 'Trillion3D tessellation uniform')
    .slice(-2)
    .map((w) => new Uint32Array(w.data.buffer, w.data.byteOffset, TESS_UNIFORM.words))
  assert.deepEqual(
    sent.map((words) => words[at.occlusion]),
    [OCCLUSION_MAIN, OCCLUSION_POST],
  )
  assert.deepEqual(
    sent.map((words) => words[at.maxOccluded]),
    [1000, 1000],
  )
  assert.equal(
    sent[1]![at.mainArgs],
    sent[0]![at.args],
    'the post pass reads the main pass’s count',
  )
  const splits = f.bindGroups.filter((g) =>
    (g.layout as unknown as { entries: { binding: number }[] }).entries.some(
      (e) => e.binding === TESS_BINDINGS.pyramid,
    ),
  )
  const read = (group: (typeof splits)[number], binding: number) =>
    [...group.entries].find((e) => e.binding === binding)!.resource
  assert.deepEqual(
    splits.map((g) => [
      (read(g, TESS_BINDINGS.pyramid) as { label: string }).label,
      (read(g, TESS_BINDINGS.levels) as GPUBufferBinding).buffer,
    ]),
    [
      ['previous', previous.levels],
      ['current', current.levels],
    ],
  )
})

test('a cut in one pass tests no patch: the pyramid is a stand-in, nothing is kept, nothing taken up', async () => {
  const { f, device, raster, frame } = rasterOf(true)
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  await new Promise((done) => setTimeout(done, 0))
  const kernels = frame()
  assert.ok(!kernels.includes('tessResume') && !kernels.includes('tessResumeArgs'))
  const kept = f.buffers.filter((b) => b.label === 'Trillion3D tessellation occluded patches')
  assert.deepEqual(
    kept.map((b) => b.size),
    [16],
    'the stand-in alone',
  )
  const words = f.writes
    .filter((w) => (w.buffer as { label?: string }).label === 'Trillion3D tessellation uniform')
    .map(
      (w) =>
        new Uint32Array(w.data.buffer, w.data.byteOffset, TESS_UNIFORM.words)[
          TESS_UNIFORM.at.occlusion
        ],
    )
  assert.deepEqual(words, [OCCLUSION_NONE, OCCLUSION_NONE])
})
