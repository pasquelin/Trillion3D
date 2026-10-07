// #364: a sprite that keeps its size on screen (`neverCulled`) is never rejected by an occlusion
// test or a blend item's box, while its quad may be on screen.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import type { HizPage } from '../../hiz/hiz.ts'
import { createHizCounts } from '../../hiz/counts.ts'
import { cameraAt } from '../../../../../tests/fixtures/hiz.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { webgpuPagesEngine } from '../../webgpu/pages/pages.ts'
import { quadScene, camera } from '../../webgpu/pages/testScenes.fixture.ts'
import { PAGE_INFO_STRIDE } from '../buffer.ts'
import { HIZ_REJECTED_WGSL, ST_REJECTED } from '../../gpu/partition/contract.ts'
import { ROW_HIZ_SLOT_WORD, restampHizSlot } from '../../webgpu/row/pageRow.ts'
import { HIZ_SHADER, HIZ_TEST_PAGES_ENTRIES } from '../../gpu/hiz/shader.ts'
import { transparentOcclusionShader } from '../../gpu/core/transparentOcclusionWgsl.ts'
import { refreshTransparentCorners } from '../../webgpu/transparent/occlusionHost.ts'
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts'
import { createWebgpuGpuState } from '../../webgpu/pages/state/gpu.ts'
import { createWebgpuBlendState } from '../../webgpu/blend/state.ts'
import { prepareWebgpuBlend } from '../../webgpu/blend/prepare.ts'
import { buildBlendStatics, refreshBlendPlan } from '../../webgpu/blend/plan.ts'
import { orderBlendPasses } from '../../webgpu/blend/order.ts'
import { itemKept } from '../../webgpu/blend/hierarchyCull.ts'
import { surfaceOf } from '../../page/surface.ts'
import { identityRoots } from '../../page/selection/placements.fixture.ts'
import { buildHizPyramid } from '../../hiz/depth.ts'
import { countUnoccluded } from '../../hiz/unoccluded.ts'
import { NO_HIZ_SLOT } from '../../webgpu/row/noHizSlot.ts'

const sprite = (sizeAttenuation: boolean) => ({ rotation: 0, sizeAttenuation })
const spriteSurface = (sizeAttenuation: boolean, parameters = {}) =>
  Object.assign(G.basicSurface(parameters), { sprite: true, rotation: 0, sizeAttenuation })

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

/** The Hi-Z slot word of every drawn row after one frame of the quad worn as `surface`. */
async function rowHizSlots(sizeAttenuation?: boolean) {
  installGpuGlobals()
  const scene = quadScene()
  if (sizeAttenuation !== undefined)
    Object.assign(scene.material, { sprite: true, rotation: 0, sizeAttenuation })
  const { device, buffers } = mockGpu()
  const backend = webgpuPagesEngine({ ...scene, gpuDevice: device, maxResidentPages: 4 })
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    const table = buffers.find((buffer) => buffer.label === 'Trillion3D page table')!
    const words = PAGE_INFO_STRIDE / 4
    const ints = new Uint32Array(table.data.buffer, table.data.byteOffset, table.size / 4)
    const slots: number[] = []
    for (let row = 0; row < table.size / PAGE_INFO_STRIDE; row++)
      if (ints[row * words + 25]) slots.push(ints[row * words + ROW_HIZ_SLOT_WORD])
    return slots
  } finally {
    await backend.dispose()
    scene.geometry.dispose()
    scene.material.dispose()
  }
}

test('a constant-size sprite row carries no Hi-Z slot, which every GPU reader draws unjudged', async () => {
  const constant = await rowHizSlots(false)
  assert.ok(constant.length > 0)
  for (const slot of constant) assert.equal(slot, NO_HIZ_SLOT)
  assert.deepEqual(await rowHizSlots(true), [0, 1], 'an attenuated sprite keeps its rank')
  assert.ok(HIZ_REJECTED_WGSL.includes('hizSlot!=0xffffffffu&&'))
  // A row moved to another rank keeps having none; any other row takes its new rank.
  const ints = new Uint32Array(64)
  ints[ROW_HIZ_SLOT_WORD] = NO_HIZ_SLOT
  ints[32 + ROW_HIZ_SLOT_WORD] = 1
  restampHizSlot(ints, 0, 7)
  restampHizSlot(ints, 32, 7)
  assert.deepEqual([ints[ROW_HIZ_SLOT_WORD], ints[32 + ROW_HIZ_SLOT_WORD]], [NO_HIZ_SLOT, 7])
})

test('the GPU Hi-Z test counts no reject for a row with no Hi-Z slot, which it keeps', () => {
  const kernel = HIZ_SHADER.slice(HIZ_SHADER.indexOf('fn testHiz'))
  const noVerdict = kernel.indexOf(`pages[row].hizSlot==0x${NO_HIZ_SLOT.toString(16)}u||`),
    kept = kernel.indexOf('return;}', noVerdict)
  // The row's slot sends it down the branch that keeps a row the pyramid cannot judge, before
  // the verdict and the reject counters.
  assert.ok(noVerdict > 0 && kept > noVerdict)
  assert.ok(kernel.indexOf(`tallyAdd(${ST_REJECTED}u,`) > kept)
  assert.ok(HIZ_SHADER.includes('@group(1) @binding(0) var<storage, read> pages:array<PageInfo>;'))
  assert.equal(HIZ_TEST_PAGES_ENTRIES[0].buffer?.type, 'read-only-storage')
})

test('the transparent occlusion test rejects no entry a constant-size sprite holds', () => {
  const page = (sizeAttenuation: boolean) => ({
    min: [0, 0, 0],
    max: [1, 1, 1],
    material: { sprite: sprite(sizeAttenuation) },
  })
  let sent = false
  const occlusion = {
    unculledBits: new Uint32Array(2),
    uploadCorners() {},
    uploadUnculled: () => (sent = true),
  }
  const pages = [page(true), page(false)]
  const rt = {
    blendState: {
      table: { capacity: 34, pageOfEntry: Int32Array.from({ length: 34 }, (_, i) => i % 2) },
      occlusion,
      occlusionEpoch: -1,
      occlusionMoved: { from: Infinity, to: -1 },
      occlusionCorners: new Float32Array(34 * 48),
    },
    layout: {
      rows: { tableEpoch: 0 },
      packedPages: pages,
      recordOf: (packed: number) => pages[packed],
      selectionRoots: identityRoots(),
      placement: { baseOfRoot: Int32Array.from([0]), rootOfPacked: identityRoots().rootOfPacked },
    },
  } as unknown as WebgpuPagesRuntime
  refreshTransparentCorners(rt)
  // Odd entries hold the constant-size sprite: bits 1, 3, …, 33.
  assert.deepEqual(Array.from(occlusion.unculledBits), [0xaaaaaaaa, 0b10])
  assert.ok(sent)
  const kernel = transparentOcclusionShader(34)
  assert.ok(kernel.includes('let open=((unculled[i>>5u]>>(i&31u))&1u)!=0u;'))
  assert.ok(kernel.includes('let reject=!open&&box.clips==0u&&'))
})

test('a constant-size sprite blend item has no box, and the frustum keeps it', () => {
  const { device } = fakeDevice()
  const blendState = createWebgpuBlendState()
  const copy = (sizeAttenuation: boolean) => {
    const material = spriteSurface(sizeAttenuation, { transparent: true })
    const geometry = new G.Geometry()
    geometry.setAttribute('position', G.floatAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
    geometry.setIndex(G.indices([0, 1, 2]))
    return Object.assign(G.mesh(geometry, material), { surface: surfaceOf(material) })
  }
  const copies = [copy(false), copy(true)]
  prepareWebgpuBlend(device, copies, createWebgpuGpuState([1, 1]), blendState, new G.Scene())
  assert.deepEqual(
    blendState.blendGpu.map((item) => item.bounds === undefined),
    [true, false],
  )
  // Planes no box passes: the attenuated sprite leaves, the constant-size one stays.
  blendState.blendPlanes.set(Float64Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? -1 : 0)))
  buildBlendStatics(blendState)
  refreshBlendPlan(blendState)
  assert.equal(orderBlendPasses(blendState, [0, 0, 0]), 1)
  assert.deepEqual(
    [0, 1].map((item) => itemKept(blendState.keepPacked, item)),
    [true, false],
  )
})
