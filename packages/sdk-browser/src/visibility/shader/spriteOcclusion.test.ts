// #364: a sprite that keeps its size on screen (`neverCulled`) is never rejected by an occlusion
// test or a blend item's box, while its quad may be on screen.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { HizPage } from '../hiz/types.ts'
import { countUnoccluded, createHizCounts } from '../hiz/unoccluded.fixture.ts'
import { cameraAt } from '../../../../../tests/fixtures/hiz.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { transparentOcclusionShader } from '../../gpu/core/transparentOcclusionWgsl.ts'
import { refreshTransparentCorners } from '../../blend/transparent/occlusionHost.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createWebgpuBlendState } from '../../blend/state.ts'
import { prepareWebgpuBlend } from '../../blend/prepare.ts'
import { refreshBlendPlan } from '../../blend/plan/plan.ts'
import { buildBlendStatics } from '../../blend/statics.ts'
import { uniformStride } from '../../session/memory/pools.ts'
import { orderBlendPasses } from '../../blend/order/order.ts'
import { blendVerdictCpu } from '../../blend/verdict/verdict.fixture.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { identityRoots } from '../../geometry/selection/placements.fixture.ts'
import { buildHizPyramid } from '../../../../../bench/oracles/browser/hizPyramid.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { createChangedRuns } from '../../geometry/residency/ranges.ts'

const sprite = (sizeAttenuation: boolean) => ({ rotation: 0, sizeAttenuation })
const spriteSurface = (sizeAttenuation: boolean, parameters = {}) =>
  G.physicalSurface({ ...parameters, sprite: true, rotation: 0, sizeAttenuation })

test('the CPU Hi-Z test keeps a constant-size sprite whose box a nearer surface hides', () => {
  const depth = new Float32Array(48 * 48).fill(0.3)
  const pyramid = buildHizPyramid(depth, 48, 48)
  const page = (sizeAttenuation: boolean): HizPage => ({
    min: [-0.05, -0.05, -3],
    max: [0.05, 0.05, -3],
    material: { sprite: sprite(sizeAttenuation) },
  })
  const [constant, attenuated] = [page(false), page(true)]
  const kept = countUnoccluded(
    [constant, attenuated],
    identityRoots(),
    pyramid,
    engineCamera(cameraAt()),
    [48, 48],
    createHizCounts(),
  )
  assert.deepEqual(kept, [constant], 'the attenuated sprite is rejected as before')
})

test('the transparent occlusion test rejects no entry a constant-size sprite holds', async () => {
  const page = (sizeAttenuation: boolean) => ({
    min: [0, 0, 0],
    max: [1, 1, 1],
    material: { sprite: sprite(sizeAttenuation) },
  })
  let sent = false
  const { device } = fakeDevice()
  const occlusion = {
    corners: device.createBuffer({ size: 34 * 48 * 4, usage: GPUBufferUsage.STORAGE }),
    unculledBits: new Uint32Array(2),
    uploadUnculled: () => (sent = true),
  }
  const pages = [page(true), page(false)]
  const rt = {
    blendState: {
      table: { capacity: 34, pageOfEntry: Int32Array.from({ length: 34 }, (_, i) => i % 2) },
      occlusion,
      occlusionEpoch: -1,
      occlusionMoved: { from: Infinity, to: -1 },
      occlusionPosed: createChangedRuns(),
    },
    gpu: { device },
    layout: {
      clusters: { infoEpoch: 0 },
      packedPages: pages,
      recordOf: (packed: number) => pages[packed],
      selectionRoots: identityRoots(),
      placement: identityRoots().placement,
    },
  } as unknown as WebgpuPagesRuntime
  // The first image asks the kernel and derives nothing; the next derives the corners.
  refreshTransparentCorners(rt, device.createCommandEncoder())
  await pipelinesSettled(device, true)
  refreshTransparentCorners(rt, device.createCommandEncoder())
  // Odd entries hold the constant-size sprite: bits 1, 3, …, 33.
  assert.deepEqual(Array.from(occlusion.unculledBits), [0xaaaaaaaa, 0b10])
  assert.ok(sent)
  const kernel = transparentOcclusionShader()
  assert.ok(kernel.includes('let open=bitIsSet(unculled[bitWord(i)],i);'))
  assert.ok(kernel.includes('let reject=!open&&box.clips==0u&&'))
})

test('a constant-size sprite blend item has no box, and the frustum keeps it in view', () => {
  const blendState = createWebgpuBlendState()
  const copy = (sizeAttenuation: boolean) => {
    // Transmissive: whether its water is in view is the one verdict a blend item's box takes.
    const material = spriteSurface(sizeAttenuation, { transparent: true, transmission: 1 })
    const geometry = new Geometry()
    geometry.setAttribute('position', G.floatAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
    geometry.setIndex(G.indices([0, 1, 2]))
    return Object.assign(G.mesh(geometry, material), { surface: surfaceOf(material) })
  }
  const copies = [copy(false), copy(true)]
  prepareWebgpuBlend(copies, blendState)
  assert.deepEqual(
    blendState.blendGpu.map((item) => item.bounds === undefined),
    [true, false],
  )
  // Planes no box passes: the attenuated sprite leaves, the constant-size one stays.
  blendState.blendPlanes.set(Float64Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? -1 : 0)))
  buildBlendStatics(blendState, uniformStride())
  refreshBlendPlan(blendState)
  orderBlendPasses(blendState, [0, 0, 0])
  // The verdict the GPU computes, item by item (`verdict.fixture.ts`, held to the kernel's words).
  assert.equal(blendVerdictCpu(blendState).inView, 1)
})
