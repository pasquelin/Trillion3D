// The depth of field: the thin lens's circle of confusion, the bokeh's area, and its passes in order.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dispatchedEntries,
  type FakeBuffer,
} from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { DEPTH_OF_FIELD_PASS } from '../../diagnostic/stage/passLabels.ts'
import {
  drawn,
  frameOf,
  input,
  intsOf,
  loaded,
  recorder,
  wordsOf,
} from './webgpuEffects.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { resolveDepthOfField } from '../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'
import { cocRadiusAt, compileCocModel } from './depthOfField/cocModel.ts'
import { compileBokehModel } from './depthOfField/bokehModel.ts'
import { DOF_PARAMS, DOF_PARAMS_BYTES } from './depthOfField/dofLayout.ts'
import { setupHalfShader } from './depthOfField/dofSetupWgsl.ts'

/** A 1920 × 1080 image through the fixture's 40-degree vertical field. */
const VIEW = { width: 1920, height: 1080, cotHorizontal: 1.5455, cotVertical: 2.7474774 }
const lensOf = (options: object) =>
  compileCocModel(resolveDepthOfField(options), VIEW, {
    maxForeground: 0.025,
    maxBackground: 0.025,
  })
const close = (a: number, b: number, message: string, within = 1e-6) =>
  assert.ok(Math.abs(a - b) < within, `${message}: ${a} against ${b}`)

test('a circle of confusion is the thin lens’s, and the shader reads the same model', () => {
  const model = lensOf({ focusDistance: 2, aperture: 2 })
  // The circle at infinity, f² / (N (F − f)) across, as a share of the sensor's width (24.576 mm).
  const f = 0.5 * (0.024576 / (16 / 9)) * VIEW.cotVertical
  const infinity = (f * f) / (2 * (2 - f)) / 2 / 0.024576
  close(model.infinityRadius, infinity, 'at infinity', 1e-9)
  close(cocRadiusAt(model, 10, 1920), 0.8 * infinity * 1920, 'behind the focus')
  close(cocRadiusAt(model, 1, 1920), -infinity * 1920, 'in front of it: negative')
  assert.equal(cocRadiusAt(model, 0.01, 1920), -0.025 * 1920, 'held to the largest foreground')
  const blur = lensOf({ depthBlurRadius: 6 })
  close(cocRadiusAt(blur, 1000, 1920), 6, 'half the depth blur at 1 km')
  assert.equal(cocRadiusAt(lensOf({}), 5, 1920), 0, 'no focus, no blur: no circle')
  for (const lens of [lensOf({ focusDistance: 2, aperture: 2, depthBlurRadius: 4 }), blur]) {
    const coc = [lens.infinityRadius, lens.minForeground, lens.maxBackground, lens.depthBlurRadius]
    const view = { coc, lens: [1, 1, lens.depthBlurExponent, lens.focusDistance] }
    const { cocOfDepth } = shaderRun<{ cocOfDepth: (depth: number, basis: number) => number }>(
      setupHalfShader(),
      ['cocOfDepth'],
      { view },
    )
    for (const depth of [0.01, 1, lens.focusDistance || 3, 10, 1e4])
      close(cocOfDepth(depth, 960), cocRadiusAt(lens, depth, 960), `${depth} m`, 1e-4)
  }
})

test('a bokeh has the area of the circle: a polygon of blades, rounded ones between', () => {
  const bokeh = (aperture: number, minAperture: number, bladeCount = 5) =>
    compileBokehModel(resolveDepthOfField({ aperture, minAperture, bladeCount }), 1)
  assert.equal(bokeh(1.2, 1.2).shape, 'circle', 'wide open')
  const six = bokeh(1.2, 0, 6) // corners at √(2π / (6 sin 60°)), sides at R cos 30°
  close(six.circumscribed, Math.sqrt(Math.PI / 3 / Math.sin(Math.PI / 3)), 'corners', 1e-12)
  close(six.incircle, six.circumscribed * Math.cos(Math.PI / 6), 'sides', 1e-12)
  const [near, far] = [1.25, 32].map((aperture) => bokeh(aperture, 1.2))
  assert.ok(near.circumscribed < far.circumscribed && near.incircle > far.incircle)
  close(near.circumscribed, 1, 'a little stopped down: almost the circle', 0.01)
  close(far.circumscribed, bokeh(32, 0).circumscribed, 'stopped far down: straight', 0.01)
})

test('the depth of field draws nothing until it has a focus, then every pass in its order, each depth of field with its own history', async () => {
  const { gpu, effects, lit } = await loaded()
  const lens = (at: number) => effect.depthOfField({ focusDistance: at, aperture: 2 })
  const [off, one, two] = [lens(0), lens(2), lens(4)]
  const { encoder } = recorder(gpu)
  const settle = () => new Promise((resolve) => setTimeout(resolve))
  const frame = frameOf(gpu, 640, 360)
  assert.equal(lit.resolve(encoder, drawn([off]), input, frame), input)
  assert.deepEqual([effects.bytes, gpu.computePipelines.length], [0, 0], 'idle: no pass, no cost')
  lit.ready([one])
  await effects.settled()
  lit.resolve(encoder, [one], input, frame)
  await settle()
  assert.notEqual(lit.resolve(encoder, [one], input, frame), input)
  assert.equal(
    [...new Set(dispatchedEntries(gpu.dispatches))].join(),
    'setupHalf,flattenCoc,dilateCoc,downsampleCoc,reduceLevels,packScatter,buildLut,gatherLayer,postfilterLayer,recombine',
  )
  assert.equal(lit.resolve(encoder, [], input, frame), input)
  assert.equal(effects.bytes, 0, 'a chain with none gives its images back')
  // An image of 480 on a display of 960: gathered at 240, accumulated at 480, a history for each; a lens
  // pulled keeps the groups; a display a pixel smaller reads the history in its own rectangle.
  const up = frameOf(gpu, 480, 270, {}, [480, 270], true, [960, 540])
  const draw = async (display: number[]) => {
    up.display = display
    lit.resolve(encoder, [one, two], input, up)
    await settle()
  }
  for (let i = 0; i < 3; i++) await draw([960, 540])
  const [first, second] = gpu.buffers
    .filter((b) => b.label?.startsWith(DEPTH_OF_FIELD_PASS) && b.size === DOF_PARAMS_BYTES)
    .slice(-2)
  const at = DOF_PARAMS.at
  const field = (buffer: FakeBuffer, from: number) => [...wordsOf(buffer).slice(from, from + 4)]
  const ints = (buffer: FakeBuffer, from: number) => [...intsOf(buffer).slice(from, from + 4)]
  const sizes = [at.gather, at.pre].map((from) => ints(first, from).join())
  assert.equal(sizes.join(';'), '240,135,240,135;480,270,480,270')
  assert.ok(gpu.computePipelines.some((p) => p.compute.constants?.GATHER4))
  const made = () => gpu.textures.filter((t) => t.label?.includes('accumulated colour a'))
  const cut = (buffer: FakeBuffer) => field(buffer, at.temporal)[2]
  assert.equal(`${made().length}${cut(first)}${cut(second)}`, '200')
  const groups = gpu.bindGroups.length
  one.focusDistance = 3
  await draw([960, 540])
  assert.equal(gpu.bindGroups.length, groups, 'no group is made again')
  await draw([959, 539])
  assert.deepEqual(field(first, at.display), [959, 539, 960, 540])
  await draw([1920, 1080])
  assert.equal(`${made().length}${cut(first)}`, '41', 'the history is made again')
})
