// Every history update is a compute dispatch into storage targets, after the analysis's dispatches,
// each in a compute pass of its own label (`../../diagnostic/stage/passTable.ts`), so each is timed:
// the pass draws nothing.
import { taaInputs, taaShape, taaSlices } from './frame.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { createVelocity } from './velocity.ts'
import {
  TAA_DECIMATE_HISTORY_PASS,
  TAA_DETECT_THIN_GEOMETRY_PASS,
  TAA_RELAX_THIN_GEOMETRY_PASS,
  TAA_DILATE_VELOCITY_PASS,
  TAA_MEASURE_FLICKERING_LUMA_PASS,
  TAA_MEASURE_THIN_COVERAGE_PASS,
  TAA_REJECT_SHADING_PASS,
  TAA_RESOLVE_HISTORY_PASS,
  TAA_RESOLVE_LAYERS_PASS,
  TAA_SPATIAL_ANTI_ALIASING_PASS,
  TAA_UPDATE_HISTORY_PASS,
} from '../../diagnostic/stage/passLabels.ts'

/** The passes two frames begin — the second updating display layers, once its twin has compiled —,
 *  the updates compiled at preparation, and whether each target stores. */
async function updatePasses(timed = true) {
  const { device, computePipelines, textures, passes, computePasses } = fakeDevice({ timed })
  const temporal = await createTemporalAntialiasing(device, createVelocity(device))
  const compiled = computePipelines
    .filter(({ compute }) => compute.entryPoint === 'resolve')
    .map(({ compute }) => compute.module.label)
  temporal.resize(taaShape(8, 4), 8, 4)
  const encoder = device.createCommandEncoder()
  const view = () => ({}) as GPUTextureView
  const encode = () =>
    temporal.encode(encoder, taaInputs({ filter: [view(), view()] }), [8, 4], taaSlices())
  // Frames with no layer ask the programs they skip, till all are made; they are not counted.
  for (let asked = true; asked;) {
    temporal.encode(encoder, taaInputs(), [8, 4], taaSlices())
    const settled = pipelinesSettled(device)
    asked = !!settled
    await settled
  }
  computePasses.length = 0
  // The first frame updates no layer, its layered twin compiling off the frame.
  encode()
  await new Promise((done) => setImmediate(done))
  encode()
  temporal.dispose()
  // The zero texel bound for a responsiveness is no target.
  const stored = textures
    .filter(({ label }) => label?.match(/^Trillion3D TAA .* \d$/))
    .map(({ label, usage }) => [label, !!(usage & GPUTextureUsage.STORAGE_BINDING)] as const)
  return { compiled, drawn: passes.length, labels: computePasses.map(({ label }) => label), stored }
}

// The history's four frames (two kept for good and two rolling) and the layers' two.
const TARGETS = [
  'history 0',
  'validity 0',
  'history 1',
  'validity 1',
  'history 2',
  'validity 2',
  'history 3',
  'validity 3',
  'display tint 0',
  'display added value 0',
  'display tint 1',
  'display added value 1',
]

test('every update is a compute dispatch after the analysis, and the pass draws nothing', async () => {
  const byDefault = await updatePasses()
  // One update since a debug view's as-is pixels are composed after the temporal pass (three
  // kinds read the flags or a share).
  // Both updates a history can run (with and without the half-size image) are compiled with the pass.
  assert.deepEqual(byDefault.compiled, [
    'TAA_UPDATE false true plain',
    'TAA_UPDATE false false plain',
  ])
  assert.equal(byDefault.drawn, 0, 'no render pass: the anti-aliaser and the update dispatch')
  // Each frame: the analysis's compute passes, one per step it times (the dilated velocity, the
  // reprojection, the thin geometry detection, the rejection with its flicker measure and its merge,
  // the spatial anti-aliaser last: the whole analysis), then the history update — its
  // layered twin besides the layers —, and, the history being larger than the display, its resolve
  // (the image and the half-size image), the layers' resolve beside it in the layered
  // frame. The labels were one shared label before the passes were timed apart.
  const analysis = [
    TAA_DILATE_VELOCITY_PASS,
    TAA_DECIMATE_HISTORY_PASS,
    TAA_DETECT_THIN_GEOMETRY_PASS,
    // The thin geometry's weight relaxation, its own pass after the detection whose mask it reads.
    TAA_RELAX_THIN_GEOMETRY_PASS,
    TAA_REJECT_SHADING_PASS,
    TAA_SPATIAL_ANTI_ALIASING_PASS,
  ]
  assert.deepEqual(byDefault.labels, [
    ...[...analysis, TAA_UPDATE_HISTORY_PASS, TAA_RESOLVE_HISTORY_PASS],
    ...[...analysis, TAA_UPDATE_HISTORY_PASS, TAA_RESOLVE_HISTORY_PASS, TAA_RESOLVE_LAYERS_PASS],
  ])
  // The history and layer targets are stored by the update's dispatch: every one has the usage.
  assert.deepEqual(
    byDefault.stored
      .filter(([label]) => !label?.match(/(shading|flicker) history/))
      .map(([label]) => label?.replace('Trillion3D TAA ', ''))
      .sort(),
    [...TARGETS].sort(),
  )
  assert.deepEqual(
    byDefault.stored.filter(
      ([label, stores]) => !stores && !label?.match(/(shading|flicker) history/),
    ),
    [],
  )
})

// A frame that is not timed per pass encodes the analysis, the update and the resolve in one compute
// pass, a dispatch after the other (the device puts the barriers between them): its first label.
test('a frame not timed per pass encodes the analysis, the update and the resolve in one compute pass', async () => {
  const frames = await updatePasses(false)
  assert.deepEqual(frames.labels, [TAA_DILATE_VELOCITY_PASS, TAA_DILATE_VELOCITY_PASS])
})

// The flicker luma, and where the thin geometry detection runs the material's coverage, are measured
// in passes of their own on the scene before the translucency is composed onto it, which would
// change what they measure: the frame encodes them there (`measureBeforeTranslucency`), apart from
// the analysis.
test('the measures before the translucency are passes of their own, the coverage where the detection runs', async () => {
  const { device, computePasses } = fakeDevice({ timed: true })
  const temporal = await createTemporalAntialiasing(device, createVelocity(device))
  const view = () => ({}) as GPUTextureView
  const visibility = { ids: view(), pages: {} as GPUBuffer, flags: view(), range: 3 }
  const labels = () => computePasses.map(({ label }) => label)
  assert.equal(
    temporal.measure(device.createCommandEncoder(), view(), visibility, [8, 4], 1, false),
    false,
    'no target before the history is made: nothing measured',
  )
  temporal.resize(taaShape(8, 4, 'high'), 8, 4)
  temporal.measure(device.createCommandEncoder(), view(), visibility, [8, 4], 1, false)
  assert.deepEqual(labels(), [TAA_MEASURE_FLICKERING_LUMA_PASS])
  computePasses.length = 0
  temporal.measure(device.createCommandEncoder(), view(), visibility, [8, 4], 1, true)
  assert.deepEqual(labels(), [TAA_MEASURE_FLICKERING_LUMA_PASS, TAA_MEASURE_THIN_COVERAGE_PASS])
  temporal.dispose()
})
