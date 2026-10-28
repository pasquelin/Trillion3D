// The empty-space table of a view's clouds: asked by the settings (never in a reflection), written by
// a pass of its own before the tracing, bound where the tracing reads it, and each slice of a ray
// asking the material's output; the built-in material leaves that output unconnected, which says
// "matter is there".
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { resolveCloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { SKY_QUALITY_RULES } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { DEFAULT_AIR_SHAPE } from '../../../lighting/atmosphere/shape.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { cloudSetupOf } from './cloudModes.ts'
import { emptySpaceProgram } from './emptySpaceWgsl.ts'
import { CLOUD_MATERIAL_EMPTY_SPACE_WGSL } from './materialWgsl.ts'
import { advanceCloudView, createCloudViewState } from './reconstruct.ts'
import {
  cloudTraceExtraEntries,
  cloudTraceExtraLayoutEntries,
  cloudTraceKey,
  type CloudTraceKey,
} from './traceExtraLayout.ts'
import { cloudTraceProgram } from './traceWgsl.ts'
import { cloudSteps, encodeTrace } from './viewFrame.ts'
import { TIMED_APART, TIMED_ENCODER } from '../../../gpu/core/timedEncoder.ts'
import { createCloudViewGpu } from './viewTargets.ts'
import { cloudProgramsReady } from './viewResolve.ts'
import type { CloudViewFrame } from './viewGroups.ts'

// The buffer usage flags a browser declares and the view's blocks are made with.
globalThis.GPUBufferUsage ??= { UNIFORM: 64, COPY_DST: 8 } as never

const QUALITY = resolveSettings(SKY_QUALITY_RULES, {})
const SEEN = { reflection: false, skyCapture: false, sunShadowsOnClouds: false, airless: false }
const MARCHED = { rayMarchVolumeShadow: true }
const keyOf = (settings: object, frame = SEEN) =>
  cloudTraceKey({ ...QUALITY, ...settings }, frame, cloudSetupOf(QUALITY), MARCHED)

test('the table is asked by the setting, in a view and never in a reflection', () => {
  assert.equal(keyOf({}).emptySpace, false, 'off by default')
  assert.equal(keyOf({ cloudEmptySpaceSkipping: true }).emptySpace, true)
  assert.equal(
    keyOf({ cloudEmptySpaceSkipping: true }, { ...SEEN, reflection: true }).emptySpace,
    false,
    'a reflection reads none',
  )
})

const ON: CloudTraceKey = { ...keyOf({ cloudEmptySpaceSkipping: true }), volumeShadowMap: false }

test('the tracing reads the table where it is asked: its binding, its program and its group', () => {
  const entries = cloudTraceExtraLayoutEntries(ON)
  assert.deepEqual(
    entries.map((entry) => [entry.binding, entry.texture?.sampleType]),
    [[0, 'unfilterable-float']],
  )
  const table = { table: true } as unknown as GPUTextureView
  assert.deepEqual(cloudTraceExtraEntries(ON, { startDistance: table }), [
    { binding: 0, resource: table },
  ])
  assert.deepEqual(
    cloudTraceExtraEntries({ ...ON, emptySpace: false }, { startDistance: table }),
    [],
  )
  const code = cloudTraceProgram(ON)
  assert.ok(code.includes('var cloudStartDistance:texture_2d<f32>;'))
  assert.ok(code.includes('fn cloudEmptyStep()->u32{return 0u;}'), 'one sample over empty air')
  const off = cloudTraceProgram({ ...ON, emptySpace: false })
  assert.ok(!off.includes('cloudStartDistance'), 'no table, no read')
  assert.ok(
    off.includes('fn cloudStartSteps(p:vec2u,t:ptr<function,f32>,stepT:f32)->u32{return 0u;}'),
  )
})

/** The empty-space program's value for the froxel at `offset` of slice 3 of the texel (4, 8), with a
 *  material that answers `answer`: what it was asked and where the ray's origin was moved. */
function valueAt(eyeW: number, answer: number) {
  const asked: { rel: number[]; radius: number }[] = []
  const moved: number[][] = []
  const { emptySpaceValue } = shaderRun<{
    emptySpaceValue: (texel: number[], slice: number, offset: number[]) => number
  }>(emptySpaceProgram(true).code, ['emptySpaceValue'], {
    frame: { eye: [0, 0, 0, eyeW] },
    cloudTrace: { empty: [1000, 64000, 0, 0] },
    cloudViewRay: (ndc: number[]) => ({ origin: [ndc[0] * 100, 0, 0], dir: [0, 1, 0] }),
    cloudMoveOrigin: (origin: number[]) => moved.push(origin),
    cloudMaterialEmptySpace: (rel: number[], radius: number) => (
      asked.push({ rel, radius }),
      answer
    ),
  })
  return { value: emptySpaceValue([4, 8], 3, [0.5, 0.5, 0.5]), asked, moved }
}

test('a slice asks the material’s output at its froxel on the ray through the texel, with the froxel’s bounding radius', () => {
  const perspective = valueAt(1, 0.25)
  assert.equal(perspective.value, 0.25)
  // The froxel centre is 3.5 slices of 1000 cm along the ray; its bounding sphere is half the cube's
  // diagonal (1.73) across.
  assert.deepEqual(perspective.asked, [{ rel: [0, 3500, 0], radius: 0.5 * 1000 * 1.73 }])
  assert.deepEqual(perspective.moved, [], 'a perspective ray leaves the eye')
  // An orthographic view's ray leaves the texel's own point, as the tracing's.
  const orthographic = valueAt(0, 1)
  assert.deepEqual(orthographic.moved, [[-71.875, 0, 0]])
})

test('the built-in material leaves the output unconnected: matter is everywhere, nothing skipped', () => {
  const { cloudMaterialEmptySpace } = shaderRun<{
    cloudMaterialEmptySpace: (rel: number[], radius: number) => number
  }>(CLOUD_MATERIAL_EMPTY_SPACE_WGSL, ['cloudMaterialEmptySpace'], {})
  assert.equal(cloudMaterialEmptySpace([0, 1e6, 0], 10), 1)
  assert.equal(cloudMaterialEmptySpace([0, -1e6, 0], 0), 1)
})

test('the corners option is a constant of the program, and the pass is the material’s whole group', () => {
  assert.ok(emptySpaceProgram(true).code.includes('const EMPTY_SPACE_CORNERS:bool=true;'))
  assert.ok(emptySpaceProgram(false).code.includes('const EMPTY_SPACE_CORNERS:bool=false;'))
  assert.ok(emptySpaceProgram(true).code.includes('@compute @workgroup_size(1,1,64)'))
})

test('the march starts where the table says: whole steps skipped short of it, none past it', () => {
  const read: number[][] = []
  const { cloudStartSteps } = shaderRun<{
    cloudStartSteps: (
      p: number[],
      t: { get(): number; set(v: number): void },
      step: number,
    ) => number
  }>(cloudTraceProgram(ON), ['cloudStartSteps'], {
    cloudTrace: { traced: [64, 36, 0, 0] },
    // The table says 3 km (300000 cm) at every texel.
    cloudStartDistance: { load: (texel: number[]) => (read.push(texel), [3, 0, 0, 0]) },
  })
  let t = 100
  const at = { get: () => t, set: (value: number) => void (t = value) }
  assert.equal(cloudStartSteps([10, 20], at, 10000), 30, '300000 cm of 10000 cm steps')
  assert.equal(t, 300100, 'the first sample moved by as many steps')
  assert.deepEqual(read[0], [5, 18], 'the texel of the pixel in the 32 by 32 table')
  t = 400000
  assert.equal(cloudStartSteps([10, 20], at, 10000), 0)
  assert.equal(t, 400000, 'a ray already past the start is not moved')
})

/** The frame of one image of a view's clouds on a fake device, tracing with the key `key`, the
 *  passes of its compute encoder recorded in order. */
function traced(key: CloudTraceKey) {
  const quality = { ...QUALITY, cloudEmptySpaceSkipping: key.emptySpace }
  const labels: string[] = []
  const passes: { label: string; groups: Record<number, unknown>; pipeline?: unknown }[] = []
  const device = {
    createTexture: (d: { label: string }) => (
      labels.push(d.label),
      { label: d.label, createView: () => ({ of: d.label }), destroy() {} }
    ),
    createBuffer: (d: { label: string }) => ({ label: d.label, destroy() {} }),
    createBindGroup: (d: { label: string; entries: GPUBindGroupEntry[] }) => d,
    queue: { writeBuffer() {} },
  } as unknown as GPUDevice
  const encoder = {
    // A frame timed with the detail asked: the empty space and the trace are a pass each, the table written before the tracing reads it.
    [TIMED_ENCODER]: true,
    [TIMED_APART]: true,
    beginComputePass: ({ label }: { label: string }) => {
      const pass = { label, groups: {} as Record<number, unknown>, pipeline: undefined as unknown }
      passes.push(pass)
      return {
        setPipeline: (pipeline: unknown) => void (pass.pipeline = pipeline),
        setBindGroup: (at: number, group: unknown) => void (pass.groups[at] = group),
        dispatchWorkgroups() {},
        end() {},
      }
    },
  } as unknown as GPUCommandEncoder
  const part = resolveCloudPart({}, quality)
  const setup = cloudSetupOf(quality)
  const view = { width: 64, height: 36 }
  const gpu = createCloudViewGpu(device)
  const pass = (name: string) => ({
    air: 'air layout',
    cloud: `${name} layout`,
    extra: 'extra layout',
    pipeline: { get: () => name },
  })
  const f = {
    device,
    encoder,
    gpu,
    part,
    setup,
    key,
    plan: advanceCloudView(createCloudViewState(), view, view, true, setup),
    image: {
      inverseView: new Float32Array(16),
      view,
      frameIndex: 0,
      time: 0,
      airPresent: true,
      lightScales: [
        [1, 1, 1],
        [1, 1, 1],
      ],
    },
    programs: {
      shape: DEFAULT_AIR_SHAPE,
      trace: () => pass('trace'),
      emptySpace: () => pass('empty space'),
    },
    sceneDepth: { of: 'scene depth' },
    material: [{ binding: 0, resource: { of: 'material block' } }],
    noise: { of: 'noise' },
    air: {
      lights: {},
      frame: {},
      transmittance: {},
      multiScatter: {},
      sampler: {},
      volumes: {},
      fog: { cubemap: {}, volume: {}, sampler: {}, tiles: {} },
    },
    extra: { startDistance: key.emptySpace ? gpu.emptySpaceTable.view : undefined },
  } as unknown as CloudViewFrame
  const views = { half: { of: 'half' }, quarter: { of: 'quarter' } }
  cloudSteps.begin(encoder)
  encodeTrace(f, { views } as never)
  cloudSteps.end()
  return { passes, labels, gpu }
}

test('with the table asked, a pass writes it before the tracing, which binds the very table and block', () => {
  const { passes, labels } = traced(ON)
  assert.deepEqual(
    passes.map((pass) => pass.label),
    ['Trillion3D cloud empty space', 'Trillion3D cloud trace'],
  )
  const [empty, trace] = passes
  assert.equal(empty.pipeline, 'empty space')
  assert.equal(labels.filter((label) => label.includes('empty space table')).length, 1)
  const written = (empty.groups[1] as { entries: { binding: number; resource: unknown }[] }).entries
  const read = (trace.groups[2] as { entries: { binding: number; resource: unknown }[] }).entries
  assert.deepEqual(
    written.map((entry) => entry.binding),
    [0, 7, 8],
    'the material, the trace’s block, the table',
  )
  assert.equal(written[2].resource, read[0].resource, 'the tracing reads the table the pass wrote')
  const block = (trace.groups[1] as { entries: { binding: number; resource: unknown }[] }).entries
  assert.deepEqual(
    written[1].resource,
    block.find((entry) => entry.binding === 7)?.resource,
    'one block for both',
  )
  const buffer = (written[1].resource as { buffer: unknown }).buffer
  assert.equal(
    buffer,
    (block.find((entry) => entry.binding === 7)?.resource as { buffer: unknown }).buffer,
  )
})

test('with the table not asked, no pass, no table', () => {
  const { passes, labels, gpu } = traced({ ...ON, emptySpace: false })
  assert.deepEqual(
    passes.map((pass) => pass.label),
    ['Trillion3D cloud trace'],
  )
  assert.equal(
    labels.some((label) => label.includes('empty space table')),
    false,
  )
  const bytes = gpu.bytes
  assert.ok(bytes > 0, 'the traced images')
  assert.ok(gpu.emptySpaceTable.view)
  assert.equal(gpu.bytes, bytes + 32 * 32 * 4, 'the table, asked, adds its own bytes')
  gpu.release()
  assert.equal(gpu.bytes, 0, 'released with the images')
})

test('a frame waits for the table’s pass to compile only when it asks for the table', () => {
  const asked: string[] = []
  const ready = (name: string, ok = true) => ({
    pipeline: { ask: () => (asked.push(name), { ready: ok }) },
  })
  const programs = {
    trace: () => ready('trace'),
    compose: () => ready('compose'),
    emptySpace: (corners: boolean) => ready(`empty space ${corners}`, false),
  } as unknown as CloudViewFrame['programs']
  // A direct trace: the scene's depth read as it is, nothing reconstructed.
  const setup = cloudSetupOf({ ...QUALITY, cloudRenderTarget: false })
  assert.equal(cloudProgramsReady(programs, setup, ON, false, true), false)
  assert.ok(asked.includes('empty space true'), 'asked of the device, with the corners option')
  asked.length = 0
  assert.equal(cloudProgramsReady(programs, setup, { ...ON, emptySpace: false }, false, true), true)
  assert.ok(!asked.some((name) => name.startsWith('empty space')))
})
