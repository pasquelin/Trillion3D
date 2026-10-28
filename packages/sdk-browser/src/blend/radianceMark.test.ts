// The translucent surfaces' mark of the radiance cache (`radianceMark.ts`): the stage's text, and when the pass is encoded.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { TranslucentMarkSettings } from '../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { installGpuGlobals } from '../../../../tests/kit/fakeDevice/globals.ts'
import { checkStageLimits } from '../../../../tests/kit/fakeDevice/limitRules.ts'
import { blendLayoutEntries } from '../gpu/bind/blendBindEntries.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { drawRadianceMark, radianceMarker } from './radianceMark.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import {
  radianceMarkBlendLayout,
  radianceMarkLayout,
  readByRadianceMark,
} from './radianceMarkStage.ts'
import {
  blendRadianceMarkShader,
  RADIANCE_MARK_DEPTH_BINDING,
  RADIANCE_MARK_GROUP,
} from './radianceMarkWgsl.ts'

installGpuGlobals()

const SETTINGS: TranslucentMarkSettings = { downsample: 4, hizMip: 2, hizTest: true, invFade: 0.25 }

test('the stage is a fragment with no output, hidden fragments discarded before the base map is sampled, and the mark group after the blend group', () => {
  const code = blendRadianceMarkShader()
  const stage = code.slice(code.indexOf('@fragment fn fsRadianceMark'))
  assert.ok(stage.length > 0)
  assert.doesNotMatch(stage, /->|@location/, 'no output')
  assert.ok(stage.indexOf('translucentMarkHidden(') < stage.indexOf('blendBase('), 'hidden first')
  assert.match(
    code,
    new RegExp(`@group\\(${RADIANCE_MARK_GROUP}\\) @binding\\(2\\) var<storage,read_write> marks`),
  )
  assert.match(
    code,
    new RegExp(
      `@group\\(${RADIANCE_MARK_GROUP}\\) @binding\\(${RADIANCE_MARK_DEPTH_BINDING}\\) var hizDepth`,
    ),
  )
})

/** A runtime with one run, and a device that records the passes it is asked. */
function scene({ runs = 1, depth = true, ready = true } = {}) {
  const passes: { draws: number[]; groups: number[] }[] = []
  const asked: string[] = []
  const pipeline = {} as GPURenderPipeline
  const device = {
    queue: { writeBuffer() {} },
    createBuffer: () => ({}),
    createTexture: ({ size }: { size: { width: number; height: number } }) => ({
      ...size,
      createView: () => ({}),
    }),
    createBindGroupLayout: () => ({}),
    createBindGroup: () => ({}),
  } as unknown as GPUDevice
  const encoder = {
    beginRenderPass() {
      const pass = { draws: [] as number[], groups: [] as number[] }
      passes.push(pass)
      return {
        setViewport() {},
        setBindGroup: (index: number) => void pass.groups.push(index),
        setPipeline() {},
        drawIndirect: (_: unknown, offset: number) => void pass.draws.push(offset),
        end() {},
      }
    },
  } as unknown as GPUCommandEncoder
  const rt = {
    gpu: { targetSize: [64, 32] },
    run: { frame: 5, gpuDrawCalls: 0, depthDrawn: true },
    vis: {
      materialTable: { viewFor() {} },
      gpuHiz: { depth: () => (depth ? { resources: [{}, {}, {}] } : undefined) },
      blendPipelines: {
        radianceMark: {
          ready,
          ask: () => void asked.push('ask'),
          at: () => pipeline,
        },
      },
    },
    blendState: {
      runCount: runs,
      argsBuffer: {},
      slotPipelines: [0],
      planRegion: { args: 0 },
      maxPlanEntries: 4,
      identity: { slot: 0 },
      sharedGroups: [],
    },
  } as unknown as WebgpuPagesRuntime
  const draw = () =>
    drawRadianceMark(rt, device, encoder, {} as GPUBuffer, {} as GPUBuffer, SETTINGS)
  return { rt, device, passes, asked, draw }
}

test('the pass is encoded with runs, a depth pyramid and the stage compiled: a pass of the target the view divided by the downsample, the mark group set', () => {
  const { passes, draw, rt } = scene()
  assert.equal(draw(), 1)
  assert.equal(passes.length, 1)
  assert.deepEqual(
    passes[0].groups,
    [RADIANCE_MARK_GROUP, 0],
    'the mark group, then the blend group the runs bind',
  )
  assert.equal(rt.run.gpuDrawCalls, 1)
})

test('no pass is encoded without runs or a depth pyramid; a stage still compiling is asked and the mark skipped', () => {
  for (const missing of [{ runs: 0 }, { depth: false }]) {
    const { passes, draw } = scene(missing)
    assert.equal(draw(), 0, JSON.stringify(missing))
    assert.equal(passes.length, 0)
  }
  const compiling = scene({ ready: false })
  assert.equal(compiling.draw(), 0)
  assert.equal(compiling.passes.length, 0)
  assert.deepEqual(compiling.asked, ['ask'])
})

test('the pool gets the mark only for an image whose transparents were prepared, the same one while the device stands', () => {
  const { rt, device } = scene()
  assert.equal(radianceMarker(rt, device, false), undefined)
  const marker = radianceMarker(rt, device, true)
  assert.equal(typeof marker?.mark, 'function')
  assert.equal(radianceMarker(rt, device, true), marker, 'allocated once')
})

test('the stage binds what it reads of the blend group alone: its two layouts keep every stage within the limits, the lights and shadows left out', () => {
  const recording = {
    createBindGroupLayout: (descriptor: object) => descriptor,
  } as unknown as GPUDevice
  const items = radianceMarkBlendLayout(recording) as unknown as { entries: { binding: number }[] }
  const read = new Set(items.entries.map((entry) => entry.binding))
  assert.ok(
    !read.has(BLEND_BINDINGS.directLights) && !read.has(BLEND_BINDINGS.tileLights),
    'no light',
  )
  assert.ok(read.has(BLEND_BINDINGS.material) && read.has(BLEND_BINDINGS.color.pages), 'the maps')
  assert.equal(
    items.entries.length,
    blendLayoutEntries(BLEND_VIEW_SIZE).filter(readByRadianceMark).length,
  )
  checkStageLimits('the radiance mark stage', [items, radianceMarkLayout(recording)])
  // Every group-0 variable the stage's text declares is one its layout holds.
  const declared = [...blendRadianceMarkShader().matchAll(/@group\(0\) @binding\((\d+)\)/g)].map(
    (m) => Number(m[1]),
  )
  for (const binding of declared)
    assert.ok(read.has(binding), `binding ${binding} is declared but not in the layout`)
})
