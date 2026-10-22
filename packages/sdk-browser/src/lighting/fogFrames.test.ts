// What the frame does with the fog, on the kit's device (`fogFrames.fixture.ts`): the volume built
// between the light lists and the lighting, held off by the run, made for each view, let go with the
// scene's fog; the view block the programs read it from; the switches of the fog as a whole; and a
// view still blending its history kept drawn. Split from `fogWiring.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unsettledMask, unsettledReasons } from '../frame/loop/unsettled.ts'
import { FOG_MATCH_GLOW_SCALE, FOG_VOLUME_FRAME_AT, historyHorizon } from './fog/layout.ts'
import { validateSceneAtmosphere } from '../../../sdk-core/src/scene/core/atmosphere.ts'
import { awayCamera } from '../frame/backend/drawnQuad.fixture.ts'
import { renderWebgpuPages } from '../frame/render/render.ts'
import { flushWebgpuPages } from '../frame/render/flush.ts'
import { directLightResources } from '../frame/prepare/contractLight.ts'
import { createWebgpuView } from '../frame/backend/state/view.ts'
import { releaseWebgpuView, useWebgpuView } from '../frame/backend/state/viewSwitch.ts'
import { LIGHT_BUFFER_AT } from '../frame/backend/state/lightBufferLayout.ts'
import { FOG_VIEW_FLOATS, FOG_VIEW_SLOT } from './fog/viewSlots.ts'
import { HIZ_PASS, LIGHT_TILES_PASS, REFLECTION_PASS } from '../diagnostic/stage/passLabels.ts'
import { FOG_PASS, LIGHTING_PASS, litFrames } from './fogFrames.fixture.ts'

test('a frame with the volumetric fog on builds the volume between the light lists and the lighting, its three passes in order', async () => {
  const { rt, gpu, draw } = await litFrames({ baseDensity: 0.01, volumetric: true })
  const frame = await draw()
  const fog = frame.indexOf(FOG_PASS)
  assert.ok(frame.indexOf(`compute ${LIGHT_TILES_PASS}`) < fog, 'after the light lists')
  assert.ok(fog < frame.indexOf(LIGHTING_PASS), 'before the lighting that reads it')
  assert.equal(frame.filter((command) => command === FOG_PASS).length, 1, 'one compute pass')
  // Its furthest depth reads the pyramid of this very image: the raster's last build (the culling
  // layer, rebuilt after the rest pass) and the finished depth's layers (the depth pass of the
  // reflections) both come before it.
  const built = frame.lastIndexOf(`compute ${HIZ_PASS}`)
  const finished = frame.indexOf(`compute ${REFLECTION_PASS}`)
  assert.ok(built >= 0 && built < finished && finished < fog, 'after the pyramid is built')
  const entries = gpu.dispatches.map((d) => d.entryPoint)
  const first = entries.indexOf('furthestMain')
  assert.deepEqual(entries.slice(first, first + 3), [
    'furthestMain',
    'scatterMain',
    'integrateMain',
  ])
  // What the lighting, the blends and the sky are bound to is the volume it built, kept from one
  // image to the next while nothing changes; not the stand-ins a scene with no volume reads.
  const { placeholders } = rt.gpu.deferred!
  const read = rt.gpu.fogVolume?.read
  assert.ok(read && read === directLightResources(rt).fog)
  assert.notEqual(read.volume, placeholders.fog.volume)
  await draw()
  assert.equal(rt.gpu.fogVolume?.read, read)
})

test('a volumetric fog the run holds off draws no volume and the programs read the stand-ins', async () => {
  const { rt, draw } = await litFrames(
    { baseDensity: 0.01, volumetric: true },
    { volumetricFogQuality: 'off' },
  )
  assert.ok(!(await draw()).includes(FOG_PASS))
  assert.equal(directLightResources(rt).fog?.volume, rt.gpu.deferred!.placeholders.fog.volume)
  assert.equal(rt.gpu.fogVolume?.gpu, undefined, 'its pipelines are not even compiled')
})

test('a volume that reaches nowhere is not built: its slices would divide by nothing', async () => {
  const { rt, draw } = await litFrames({ baseDensity: 0.01, volumetric: { reach: 0 } })
  assert.ok(!(await draw()).includes(FOG_PASS))
  assert.equal(rt.gpu.fogVolume?.gpu, undefined, 'its pipelines are not even compiled')
})

test('a scene with no volumetric fog makes none of it: no pass, no state', async () => {
  const { rt, draw } = await litFrames({ baseDensity: 0.01 })
  assert.ok(!(await draw()).includes(FOG_PASS))
  assert.equal(rt.gpu.fogVolume, undefined)
})

/** The view block the last image wrote into the light buffer. */
function viewBlock(gpu: Awaited<ReturnType<typeof litFrames>>['gpu']) {
  const written = gpu.writes.filter((w) => w.offset === LIGHT_BUFFER_AT.fogView).at(-1)
  assert.ok(written, 'the view block is written into the light buffer')
  return new Float32Array(written.data.buffer, written.data.byteOffset, FOG_VIEW_FLOATS)
}
const lane = (block: Float32Array, slot: number, k: number) => block[slot * 4 + k]
/** Its eye lane, 1 where the volume was built. */
const builtLane = (gpu: Awaited<ReturnType<typeof litFrames>>['gpu']) =>
  lane(viewBlock(gpu), FOG_VIEW_SLOT.eye, 3)

test('the volume tells the surfaces it was built in the light buffer: the view block, zeroed when it is not', async () => {
  const built = await litFrames({ baseDensity: 0.01, volumetric: true })
  await built.draw()
  assert.equal(builtLane(built.gpu), 1)
  // The run then holds the volume off: the block, which held it built, is written again, zeroed.
  Object.assign(built.rt.context, { volumetricFogQuality: 'off' })
  await built.draw()
  assert.equal(builtLane(built.gpu), 0)
})

test('each view holds its own volume and history: a released view lets its own go, the main view keeps its', async () => {
  const { rt, draw } = await litFrames({ baseDensity: 0.01, volumetric: true })
  await draw()
  const main = rt.gpu.fogVolume
  assert.ok(main?.gpu)
  const side = createWebgpuView(16, 16)
  useWebgpuView(rt, side)
  assert.equal(rt.gpu.fogVolume, undefined, 'the side view has none yet')
  for (let i = 0; i < 6; i++) {
    renderWebgpuPages(rt, awayCamera())
    await flushWebgpuPages(rt)
  }
  assert.ok(rt.gpu.fogVolume?.gpu && rt.gpu.fogVolume !== main, 'a volume of its own')
  releaseWebgpuView(rt, side)
  assert.equal(side.gpu.fogVolume, undefined, 'released with the view')
  assert.equal(rt.gpu.fogVolume, main, 'the main view finds its own back')
})

test('a scene that drops its fog lets its volume go', async () => {
  const { rt, draw } = await litFrames({ baseDensity: 0.01, volumetric: true })
  await draw()
  assert.ok(rt.gpu.fogVolume?.gpu)
  rt.lights.store.setEnvironment({ exposure: 1 })
  await draw()
  assert.equal(rt.gpu.fogVolume, undefined)
})

test('a still view with the volume on draws until its history is whole, then holds', async () => {
  const { rt, draw } = await litFrames({ baseDensity: 0.01, volumetric: true })
  const settling = () => unsettledReasons(unsettledMask(rt)).includes('fogVolume')
  assert.ok(settling(), 'the first images are blended with a young history')
  const horizon = historyHorizon({ volumetricFogUsesHistory: true, volumetricFogHistoryShare: 0.9 })
  for (let i = 0; i < horizon + 2; i++) await draw()
  assert.ok(!settling(), 'whole after the images its share asks')
})

test('a run that draws no fog builds no volume, and the view block tells the programs so', async () => {
  const { gpu, draw } = await litFrames(
    { baseDensity: 0.01, volumetric: true },
    { fogEnabled: false },
  )
  assert.ok(!(await draw()).includes(FOG_PASS))
  assert.deepEqual(
    [0, 1, 2, 3].map((k) => lane(viewBlock(gpu), FOG_VIEW_SLOT.options, k)),
    [1, 0, 0, 0],
  )
})

test('a scene with an atmosphere and no fog still gets the fog’s switches: the haze lies over its surfaces', async () => {
  const { rt, gpu, draw } = await litFrames(undefined, { fogReadsAtmosphere: false })
  const written = () => gpu.writes.filter((w) => w.offset === LIGHT_BUFFER_AT.fogView).length
  assert.equal(
    written(),
    0,
    'with neither a fog nor an air, nothing reads the lanes, and nothing is written',
  )
  rt.lights.store.setEnvironment({ exposure: 1, atmosphere: validateSceneAtmosphere(true) })
  for (let i = 0; i < 3; i++) await draw()
  assert.equal(
    lane(viewBlock(gpu), FOG_VIEW_SLOT.options, 1),
    1,
    'the atmosphere left out of the fog',
  )
})

test('a fog made to match the volume tells its glow, its phase and its particles to the programs, and the volume reads the glow in the fog’s unit', async () => {
  const volumetric = { glow: [100, 0, 50], anisotropy: 0.3, particleColor: [0.5, 0.6, 0.7] }
  const { rt, gpu, draw } = await litFrames(
    { baseDensity: 0.01, volumetric },
    { fogMatchesVolume: true },
  )
  await draw()
  const block = viewBlock(gpu)
  assert.equal(lane(block, FOG_VIEW_SLOT.options, 2), 1)
  const match = [0, 1, 2, 3].map((k) => lane(block, FOG_VIEW_SLOT.match, k))
  assert.ok(
    Math.abs(match[0] - 100) < 1e-3 && match[1] === 0 && Math.abs(match[3] - 0.3) < 1e-6,
    `${match}`,
  )
  assert.ok(Math.abs(lane(block, FOG_VIEW_SLOT.albedo, 2) - 0.7) < 1e-6)
  // The volume's glow: 100 per 100, in a unit 10 000 times larger.
  const frame = rt.gpu.fogVolume!.gpu!.frame
  assert.ok(Math.abs(frame[FOG_VOLUME_FRAME_AT.glow] - 1 * FOG_MATCH_GLOW_SCALE) < 1)
})
