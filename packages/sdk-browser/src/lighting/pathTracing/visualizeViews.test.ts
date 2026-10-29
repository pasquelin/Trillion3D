// The views of the payload: the modes, the settings that shape them, and what the trace and the finish keep for them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  PATH_TRACING_RULES,
  PATH_TRACING_VISUALIZE_MODES,
} from '../../../../sdk-core/src/contracts/pathTracingOptions.ts'
import {
  ATMOSPHERE_SLOT,
  ATMOSPHERE_SLOTS,
} from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { airHeld, airTraced } from './airDepth.ts'
import { viewFlagsOf } from './encodeImage.ts'
import { fittedToDevice, isPayloadView, visualizedSettings } from './framePlan.ts'
import { airBytesOf, volumeTablesBytes } from './gpuState.ts'
import { finishStageOf } from './pipelines.ts'
import { ptFinishProgram, ptTraceProgram } from './traceProgram.ts'
import { PT_CAPTURE, PT_CAPTURE_SHIFT, PT_VIEW_FLAG } from './viewWgsl.ts'
import { PT_CAPTURED_VIEW, visualizeWords } from './visualizeWgsl.ts'

const settings = (options: Parameters<typeof resolveSettings<typeof PATH_TRACING_RULES>>[1]) =>
  resolveSettings(PATH_TRACING_RULES, { pathTracing: true, ...options })

test('a view of the payload takes one sample, no denoiser and no adaptive sampling; the primary rays take the samples asked, with the same restrictions', () => {
  const view = visualizedSettings(
    settings({ pathTracingVisualize: 'WorldNormal', pathTracingSamplesPerPixel: 64 }),
  )
  assert.equal(view.pathTracingSamplesPerPixel, 1)
  assert.equal(view.pathTracingDenoiser, false)
  const primary = visualizedSettings(
    settings({ pathTracingVisualize: 'PrimaryRays', pathTracingVisualizeSamplesPerPixel: 4 }),
  )
  assert.equal(primary.pathTracingSamplesPerPixel, 4)
  assert.equal(primary.pathTracingAdaptiveSampling, false)
  assert.equal(primary.pathTracingDenoiser, false)
  const lit = settings({ pathTracingSamplesPerPixel: 64 })
  assert.equal(visualizedSettings(lit), lit)
})

test('only the views of the payload end the bounce by the view stage; the lit image and the primary rays end it by the finish', () => {
  const pipelines = { finish: 'finish', visualize: 'visualize' } as never
  assert.equal(isPayloadView('none'), false)
  assert.equal(isPayloadView('PrimaryRays'), false)
  assert.equal(isPayloadView('Roughness'), true)
  assert.equal(finishStageOf(pipelines, 'none') as unknown, 'finish')
  assert.equal(finishStageOf(pipelines, 'PrimaryRays') as unknown, 'finish')
  assert.equal(finishStageOf(pipelines, 'TriangleID') as unknown, 'visualize')
})

test('a view traces no air nor cloud', () => {
  const packed = new Float32Array(ATMOSPHERE_SLOTS * 4)
  packed[ATMOSPHERE_SLOT.planet * 4] = 1
  const on = settings({ pathTracingEnableReferenceAtmosphere: 1 })
  assert.equal(airTraced(on, packed), true)
  assert.equal(airTraced({ ...on, pathTracingVisualize: 'PrimaryRays' }, packed), false)
  assert.equal(airTraced({ ...on, pathTracingVisualize: 'Roughness' }, packed), false)
  // The view only suspends the air: its table stays held.
  assert.equal(airHeld({ ...on, pathTracingVisualize: 'Roughness' }, packed), true)
  assert.equal(airHeld(settings({ pathTracingEnableReferenceAtmosphere: 0 }), packed), false)
  assert.equal(airHeld(on, new Float32Array(ATMOSPHERE_SLOTS * 4)), false)
})

test('the sides of the air’s table and of the clouds’ map are held to the device, and counted in what the tracer asks of the budget', () => {
  const big = settings({
    pathTracingAtmosphereOpticalDepthLUTResolution: 100000,
    pathTracingCloudAccelerationMapResolution: 4096,
  })
  const fitted = fittedToDevice(big, 8192)
  assert.equal(fitted.pathTracingAtmosphereOpticalDepthLUTResolution, 8192)
  assert.equal(fitted.pathTracingCloudAccelerationMapResolution, 4096)
  assert.equal(fittedToDevice(big, 2048).pathTracingCloudAccelerationMapResolution, 2048)
  assert.equal(fittedToDevice(big, 100000), big)
  assert.equal(volumeTablesBytes(0, 0), 0)
  assert.equal(airBytesOf(0), 0)
  assert.ok(airBytesOf(256) > volumeTablesBytes(256, 0))
  assert.equal(volumeTablesBytes(512, 512), (512 * 512 + 2 * 512 * 512) * 16)
})

test('the cloud map’s side and samples are held to the reference’s ranges by the contract', () => {
  assert.equal(
    settings({ pathTracingCloudAccelerationMapResolution: 4096 })
      .pathTracingCloudAccelerationMapResolution,
    4096,
  )
  assert.throws(() => settings({ pathTracingCloudAccelerationMapResolution: 4097 }), TypeError)
  assert.throws(() => settings({ pathTracingCloudAccelerationMapNumSamples: 65537 }), TypeError)
  assert.throws(() => settings({ pathTracingCloudAccelerationMapNumSamples: 0 }), TypeError)
})

test('the options of the views hold the reference defaults', () => {
  const defaults = settings({})
  assert.equal(defaults.pathTracingVisualizeIncludeTranslucent, true)
  assert.equal(defaults.pathTracingVisualizeSamplesPerPixel, 1)
})

test('the view’s flags say what the trace keeps: the field of the views only it knows, the translucent meshes left out, the back faces kept for the kind of hit', () => {
  assert.equal(viewFlagsOf(settings({})), 0)
  const capture = (name: string) =>
    viewFlagsOf(settings({ pathTracingVisualize: name as never })) >> PT_CAPTURE_SHIFT
  assert.equal(capture('TriangleID'), PT_CAPTURE.triangle)
  assert.equal(capture('InstanceID'), PT_CAPTURE.instance)
  assert.equal(capture('ClusterID'), PT_CAPTURE.cluster)
  assert.equal(capture('LightingChannelMask'), PT_CAPTURE.channels)
  assert.equal(capture('Roughness'), PT_CAPTURE.none)
  assert.deepEqual(Object.keys(PT_CAPTURED_VIEW).sort(), [
    'ClusterID',
    'InstanceID',
    'LightingChannelMask',
    'TriangleID',
  ])
  const without = viewFlagsOf(
    settings({ pathTracingVisualize: 'Roughness', pathTracingVisualizeIncludeTranslucent: false }),
  )
  assert.equal(without & PT_VIEW_FLAG.skipTranslucent, PT_VIEW_FLAG.skipTranslucent)
  assert.equal(
    viewFlagsOf(settings({ pathTracingVisualize: 'HitKind' })) & PT_VIEW_FLAG.keepBackFaces,
    PT_VIEW_FLAG.keepBackFaces,
  )
  assert.equal(
    viewFlagsOf(settings({ pathTracingVisualize: 'Roughness' })) & PT_VIEW_FLAG.keepBackFaces,
    0,
  )
})

test('the words of a view hold its number in the list, its count and the length of its occlusion ray', () => {
  const words = new Uint32Array(visualizeWords('TriangleID', 5, 2))
  assert.equal(words[0], PATH_TRACING_VISUALIZE_MODES.indexOf('TriangleID'))
  assert.equal(words[1], 5)
  assert.equal(new Float32Array(words.buffer)[2], 2)
})

test('the trace keeps the hash of the instance in the row flags of a hit it captures and ignores the back faces of the camera’s ray unless asked; the finish draws every view', () => {
  const trace = ptTraceProgram()
  assert.match(trace, /if\(capture!=0u\)\{\s*h\.classKey=16777215u;/)
  assert.match(trace, /bits=ptPlacements\[at\+5u\]/)
  assert.match(trace, /select\(0u,ST_CULL_BACK,bounce==0u&&!ptKeepsBackFaces\(\)\)/)
  assert.match(trace, /select\(ST_MEET_TRANSLUCENT,0u,ptSkipsTranslucent\(\)\)/)
  const finish = ptFinishProgram()
  for (const name of PATH_TRACING_VISUALIZE_MODES.filter(
    (n) =>
      n !== 'none' && n !== 'PrimaryRays' && n !== 'VolumeLightCount' && n !== 'TransparencyCount',
  ))
    assert.match(
      finish,
      new RegExp(`(case |,)${PATH_TRACING_VISUALIZE_MODES.indexOf(name)}u[,:]`),
      name,
    )
  for (const name of ['VolumeLightCount', 'TransparencyCount'] as const)
    assert.match(finish, new RegExp(`m==${PATH_TRACING_VISUALIZE_MODES.indexOf(name)}u`), name)
  assert.match(finish, /ptShowing=true;/)
})

test('a path through the views asks the material for no draw: coverage and glass are not picked at random', () => {
  const finish = ptFinishProgram()
  assert.match(finish, /if\(s\.opacity<1\.0&&!ptShowing\)\{/)
  assert.match(finish, /if\(m\.transmission>0\.0&&!ptShowing\)\{/)
})
