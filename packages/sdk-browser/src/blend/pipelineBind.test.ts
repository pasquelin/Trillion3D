import { createGraphFrame } from '../frame/render/graphFrame.ts'
import { createRootOffsets } from '../frame/render/rootOffsets.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../geometry/pages/surface.ts'
import { drawBlendPass } from './draw.ts'
import { cullOf } from './plan/planCull.ts'
import { blendLightResources } from './lighting.ts'
import { refreshBlendPlan } from './plan/plan.ts'
import { buildBlendStatics } from './statics.ts'
import { uniformStride } from '../session/memory/pools.ts'
import { orderBlendPasses } from './order/order.ts'
import { createWebgpuBlendState } from './state.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { reflectionFront } from '../lighting/reflections/frontDepth.fixture.ts'
import type { Side } from '../../../sdk-core/src/contracts/material.ts'
import { NO_OVERRIDES } from '../frame/backend/state/viewOverrides.ts'
import { translucentCloudVertex } from './cloudVertex.ts'
import { createSceneLightStore } from '../../../sdk-core/src/scene/light/store.ts'
import type { CloudShadowSet } from '../lighting/atmosphere/cloudShadowRead.ts'
import { installGpuGlobals } from '../../../../tests/kit/fakeDevice/globals.ts'

const FRONT = 'front' as unknown as GPURenderPipeline,
  BACK = 'back' as unknown as GPURenderPipeline,
  TEXTURED = 'textured' as unknown as GPURenderPipeline

/** An already-bound blend item: only the pipeline sequence is observed here. Every item reads the
 *  one shared group, its clusters from the page cache: items of one pipeline share draws. */
const item = (side: Side, negatif = false, twoSidedPasses = false) => {
  const matrix = new Matrix4()
  if (negatif) matrix.makeScale(-1, 1, 1)
  return { surface: surfaceOf(G.basicSurface({ side, twoSidedPasses })), matrix }
}

function joue(items: ReturnType<typeof item>[]) {
  const gpu = fakeDevice()
  // Bind groups are rebuilt on the first pass, when lighting resources enter the key: the stub
  // gives enough for construction to succeed. Pipeline order is not decided in the encode
  // loop: it is baked in the static plan, one entry per face, built with the scene. It is therefore
  // built here the way prepare does.
  const blendState = Object.assign(createWebgpuBlendState(), {
    argsBuffer: gpu.device.createBuffer({
      size: 4096,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    itemBuffer: {} as GPUBuffer,
    viewBuffer: {} as GPUBuffer,
  })
  blendState.blendGpu.push(...(items as unknown as (typeof blendState.blendGpu)[number][]))
  buildBlendStatics(blendState, uniformStride())
  refreshBlendPlan(blendState)
  // Frame ranking sets the frustum verdict and slices the plan into runs: it is what decides how
  // many draws the pass encodes. All items are at the same place, so source order breaks them.
  orderBlendPasses(blendState, [0, 0, 0])
  const rt = {
    vis: {
      blendPipelines: {
        // The pipeline of a rank by its cull, whatever its mode and lighting program.
        at: (rank: number) => [TEXTURED, FRONT, BACK][cullOf(rank)],
        lit() {
          return this
        },
        reach: () => undefined,
      },
      blendBindGroupLayout: {},
      textures: {
        color: { views: [{}, {}, {}], pages: { buffer: {} } },
        data: { views: [{}, {}, {}], pages: { buffer: {} } },
        feedback: { buffer: {} },
      },
      mapsSampler: {},
      materialTable: { view: {}, viewFor: () => ({}) },
      graphFrame: createGraphFrame(),
      rootOffsets: createRootOffsets(),
    },
    gpu: {
      device: gpu.device,
      // The transparents' front layer and the proxy's store, a texel each.
      reflection: reflectionFront(),
      hdrView: {},
      colorView: {},
      depthView: {},
      responsive: { view: {} },
      targetSize: [8, 8],
      backdrop: { colorView: {}, depthView: {}, active: false },
      translucency: { colorView: {}, modulationView: {}, group: {}, active: true, phase: 'idle' },
      cache: { buffer: {} },
      zeroUv: {},
      deferred: {
        placeholders: {
          slices: {},
          atlasView: {},
          sampler: {},
          fog: {},
        },
      },
    },
    lights: {
      buffer: {},
      shadows: undefined,
      store: { count: 0, epoch: 0, unlit: false, simple: { capacity: 0 } },
    },
    bounce: { probes: undefined },
    views: { active: { overrides: NO_OVERRIDES } },
    context: {},
    // `lit` view with no light: the contract lights, so the pass binds its default resources.
    blendState,
    run: {
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendPagedTriangles: 0,
      blendSubmittedTriangles: 0,
    },
  } as unknown as WebgpuPagesRuntime
  // The lighting of the image, resolved once as `encodeBlend` does before any pass.
  blendState.lighting = blendLightResources(rt)
  drawBlendPass(rt, gpu.device, gpu.device.createCommandEncoder())
  // Each pipeline the pass set, in order; the rank of the RUN whose indirect argument each draw
  // rereads: one run per draw, and the instances of all its entries in sequence.
  const pipelines = gpu.passes.flatMap(({ commands }) =>
    commandArgs(commands, 'setPipeline').map(([pipeline]) => pipeline),
  )
  const draws = gpu.draws.map(({ offset }) => offset! / 16)
  return { pipelines, draws, calls: rt.run.blendDrawCalls, entries: blendState.seeds.length }
}

test('items that set the same pipeline fit in ONE draw', () => {
  // That is the whole lot: five items in a row, one draw order. They all read the same page
  // cache, and their instances follow each other in the expanded list, farthest to nearest.
  const fondu = joue([
    item(G.FRONT_SIDE),
    item(G.FRONT_SIDE),
    item(G.FRONT_SIDE),
    item(G.FRONT_SIDE),
    item(G.FRONT_SIDE),
  ])
  assert.equal(fondu.calls, 1, 'five items, one draw')
  assert.deepEqual(fondu.draws, [0])
  assert.deepEqual(fondu.pipelines, [BACK])

  // Pipeline remains the only break: two faces requested, two runs, and not one more.
  const deuxFaces = joue([item(G.FRONT_SIDE), item(G.BACK_SIDE), item(G.FRONT_SIDE)])
  assert.equal(deuxFaces.calls, 3, 'the pipeline changes twice, hence three runs')
  assert.deepEqual(deuxFaces.pipelines, [BACK, FRONT, BACK])
})

test('two-sided items draw in ONE pass, one entry each, on the pipeline that culls nothing', () => {
  const pages = joue([item(G.DOUBLE_SIDE), item(G.DOUBLE_SIDE), item(G.DOUBLE_SIDE)])
  assert.equal(pages.entries, 3, 'one entry per item')
  assert.equal(pages.calls, 1, 'three entries, one draw')
  assert.deepEqual(pages.pipelines, [TEXTURED])
  assert.equal(joue([item(G.DOUBLE_SIDE), item(G.DOUBLE_SIDE, true)]).entries, 2)
})

test('two-sided items that ask two passes draw back and face in ONE draw, the vertex stage culling for them', () => {
  // The vertex stage culls for them (plan.ts, VERTEX CULL): a mirrored matrix swaps their cull
  // modes, not their pipeline, and the whole row still fits in one draw.
  const pages = joue([item(G.DOUBLE_SIDE, false, true), item(G.DOUBLE_SIDE, false, true)])
  assert.equal(pages.entries, 4, 'two entries per item')
  assert.equal(pages.calls, 1, 'four entries, one draw')
  assert.deepEqual(pages.pipelines, [TEXTURED])
  const renverse = joue([item(G.DOUBLE_SIDE, false, true), item(G.DOUBLE_SIDE, true, true)])
  assert.equal(renverse.calls, 1)
  assert.equal(renverse.entries, 4)
})

test('the translucent cloud shade is the forward light’s map and block, made once an image, the stand-in where that light has none or the project switch is off', () => {
  installGpuGlobals()
  const writes: unknown[] = []
  const device = {
    createTexture: () => ({ createView: () => ({}) }),
    createBuffer: () => ({}),
    createSampler: () => ({}),
    queue: { writeBuffer: (...args: unknown[]) => writes.push(args) },
  } as unknown as GPUDevice
  const store = createSceneLightStore()
  const sun = (id: string, extra = {}) => ({
    id,
    kind: 'directional' as const,
    direction: [0, -1, 0] as [number, number, number],
    color: [1, 1, 1] as [number, number, number],
    intensity: 2,
    castsShadow: false,
    ...extra,
  })
  store.add(sun('sun', { intensity: 6 }))
  store.add(sun('moon', { atmosphereSunIndex: 1 }))
  const rt = {
    run: { frame: 1 },
    lights: { store },
    gpu: {},
    vis: { blendPipelines: { reads: { clouds: true, fog: false } } },
    blendState: { cloudShade: true },
  } as unknown as WebgpuPagesRuntime
  const shadeOf = (shadow?: CloudShadowSet) => translucentCloudVertex(rt, device, shadow).shade
  const [mapSun, mapMoon] = [{ sun: true }, { moon: true }] as unknown as [
    GPUTextureView,
    GPUTextureView,
  ]
  const frame = {
    clipFromCamera: new Array(16).fill(0),
    farDepthKm: 5,
    surfaceStrength: 1,
    airStrength: 1,
  }
  const set = {
    maps: [mapSun, mapMoon],
    sampler: {},
    block: {},
    frames: [frame, frame],
    camera: [0, 0, 0],
  } as unknown as CloudShadowSet
  const none = shadeOf(undefined)
  const made = writes.length // the stand-in's own block
  rt.run.frame++
  const first = shadeOf(set)
  assert.equal(first.map, mapSun, 'the brightest directional light, the air’s first')
  assert.notEqual(first, none)
  assert.equal(shadeOf(set), first, 'the pass binds twice an image')
  assert.equal(writes.length, made + 1, 'the block is written once')
  store.set('moon', { forwardShadingPriority: 1 })
  rt.run.frame++
  assert.equal(shadeOf(set).map, mapMoon, 'its priority wins')
  assert.equal(writes.length, made + 2)
  store.set('moon', { forwardShadingPriority: 2, atmosphereSun: false })
  rt.run.frame++
  assert.equal(shadeOf(set), none, 'a light of no map: the stand-in')
  // The project switch off (programs read the clouds for a `cloudFog` surface alone): no shade.
  rt.blendState.cloudShade = false
  rt.run.frame++
  assert.equal(shadeOf(set), none, 'the switch off: the stand-in, whatever the map')
})
