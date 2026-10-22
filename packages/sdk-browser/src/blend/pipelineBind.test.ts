import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../geometry/pages/surface.ts'
import { drawBlendPass } from './draw.ts'
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

const FRONT = 'front' as unknown as GPURenderPipeline,
  BACK = 'back' as unknown as GPURenderPipeline,
  TEXTURED = 'textured' as unknown as GPURenderPipeline

/** An already-bound blend item: only the pipeline sequence is observed here. Every item reads the
 *  one shared group, its clusters from the page cache: items of one pipeline share draws. */
const item = (side: Side, negatif = false) => {
  const matrix = new Matrix4()
  if (negatif) matrix.makeScale(-1, 1, 1)
  return { surface: surfaceOf(G.basicSurface({ side })), matrix }
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
      blendPipelines: Object.assign([TEXTURED, FRONT, BACK], {
        lit() {
          return this
        },
        reach: () => undefined,
      }),
      blendBindGroupLayout: {},
      textures: {
        color: { views: [{}, {}, {}], pages: { buffer: {} } },
        data: { views: [{}, {}, {}], pages: { buffer: {} } },
        feedback: { buffer: {} },
      },
      mapsSampler: {},
      materialTable: { view: {}, viewFor: () => ({}) },
    },
    gpu: {
      // The transparents' front layer and the proxy's store, a texel each.
      reflection: reflectionFront(),
      hdrView: {},
      colorView: {},
      depthView: {},
      asIsShare: { view: {}, givenUpView: {} },
      targetSize: [8, 8],
      backdrop: { colorView: {}, depthView: {}, active: false },
      cache: { buffer: {} },
      zeroUv: {},
      deferred: {
        placeholders: {
          slices: {},
          atlasView: {},
          sampler: {},
          bounceGrid: {},
          probes: {},
          fog: {},
        },
      },
    },
    lights: { buffer: {}, shadows: undefined, store: { count: 0, epoch: 0, unlit: false } },
    bounce: { probes: undefined },
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
  return { pipelines, draws, calls: rt.run.blendDrawCalls }
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

test('two-sided items draw back and face in ONE draw, on the pipeline that culls nothing', () => {
  // The vertex stage culls for them (plan.ts, VERTEX CULL): a mirrored matrix swaps their cull
  // modes, not their pipeline, and the whole row still fits in one draw.
  const pages = joue([item(G.DOUBLE_SIDE), item(G.DOUBLE_SIDE), item(G.DOUBLE_SIDE)])
  assert.equal(pages.calls, 1, 'six entries, one draw')
  assert.deepEqual(pages.pipelines, [TEXTURED])
  const renverse = joue([item(G.DOUBLE_SIDE), item(G.DOUBLE_SIDE, true)])
  assert.equal(renverse.calls, 1)
})
