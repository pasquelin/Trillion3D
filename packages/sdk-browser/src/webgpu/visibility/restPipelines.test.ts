// S19.5: the tested half draws after its compaction, which removed every row the pyramid rejected
// (`../../gpu/raster/restCompactEquivalence.test.ts`: no rejected instance is drawn). Every row
// left passes the verdict the tested vertex stage reads again, so a compacted tested slot draws
// with its occluder twin — the same states, `vis_vs` —; without a compaction, the verdict read
// (`vis_hiz_vs`) stays the fallback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { functionsOf } from '../../texture/shaderRule.fixture.ts'
import { VIS_SHADER } from '../../visibility/buffer.ts'
import { BASE_SLOTS } from '../../gpu/draw/draw.ts'
import { createGpuRestCompact } from '../../gpu/raster/restCompact.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { createWebgpuVisibilityRasterPipelines } from './pipelines.ts'
import { encodeWebgpuVisibilityPasses } from './passes.ts'
import { createDrawItemWordsHold } from './itemWords.ts'

test('the tested vertex stage is the occluder one and its verdict read, nothing else', () => {
  const [plain, tested] = ['vis_vs', 'vis_hiz_vs'].map((name) => functionsOf(VIS_SHADER, [name]))
  const verdict =
    ' if(hizRejected(page.hizSlot)){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}\n'
  assert.ok(tested.includes(verdict))
  assert.equal(tested.replace(verdict, '').replace('fn vis_hiz_vs(', 'fn vis_vs('), plain)
})

test('a tested pipeline is its occluder twin but for the vertex stage', async () => {
  const { device } = fakeDevice()
  const made = (await createWebgpuVisibilityRasterPipelines(
    device,
    {} as GPUShaderModule,
    {} as GPUBindGroupLayout,
    true,
  )) as unknown as Record<string, GPURenderPipelineDescriptor>
  for (const face of ['Back', 'None', 'Front']) {
    const twin = made[`visPipeline${face}`],
      tested = made[`visHizRest${face}`]
    assert.equal(twin.vertex.entryPoint, 'vis_vs')
    assert.equal(tested.vertex.entryPoint, 'vis_hiz_vs')
    assert.deepEqual({ ...tested, vertex: twin.vertex }, twin, face)
  }
})

test('the compaction says whether it ran: no rows, no slots or disposed, the verdict is read', async () => {
  const fake = fakeDevice()
  const buffer = fake.device.createBuffer({ size: 64, usage: 0 })
  const compact = (await createGpuRestCompact(fake.device, {
    instances: buffer,
    indirect: buffer,
    slotOffsets: buffer,
    flags: buffer,
  }))!
  let dispatches = 0
  const pass = {
    setBindGroup() {},
    setPipeline() {},
    dispatchWorkgroups: () => void dispatches++,
  } as unknown as GPUComputePassEncoder
  const open = { pass }
  assert.equal(compact.encode(open, 3, 0, buffer), false)
  assert.equal(compact.encode(open, 0, 5, buffer), false)
  assert.equal(dispatches, 0)
  // Count, scan, scatter: three dispatches of the frame's pass, none of its own.
  assert.equal(compact.encode(open, 3, 5, buffer), true)
  assert.equal(dispatches, 3)
  compact.dispose()
  assert.equal(compact.encode(open, 3, 5, buffer), false)
})

/** Each pipeline as a name: layer 0's own, then each coplanar layer's five culls, occluders first. */
const PIPELINES = {
  visPipelineBack: 'back',
  visPipelineNone: 'none',
  visPipelineFront: 'front',
  visHizRestBack: 'tested back',
  visHizRestNone: 'tested none',
  visHizRestFront: 'tested front',
  visLayerPipelines: Array.from({ length: 10 }, (_, i) => `layer ${i}`),
}

test('the secondary pass draws with the occluder twins exactly when the compaction ran', () => {
  const drawn = (compacted: boolean) => {
    const pipelines: Record<string, unknown[]> = {}
    const encoder = {
      beginRenderPass: ({ label }: GPURenderPassDescriptor) => {
        const set = (pipelines[label!] = [] as unknown[])
        const pass = { setViewport() {}, setBindGroup() {}, drawIndirect() {}, end() {} }
        return { ...pass, setPipeline: (pipeline: unknown) => void set.push(pipeline) }
      },
      beginComputePass: () => ({ end() {} }),
    } as unknown as GPUCommandEncoder
    const rt = {
      vis: {
        visView: {},
        pageTable: {},
        drawLayerSlots: 2,
        visBindGroupLayout: {},
        zeroFlags: {},
        visSlotGroups: new Array(4 * BASE_SLOTS).fill({}),
        gpuDraw: { indirectBuffer: {} },
        gpuHiz: { level0View: {}, flags: {}, encodePyramid() {}, encodeTest() {} },
        gpuRestCompact: { encode: () => compacted },
        ...PIPELINES,
      },
      gpu: { depthView: {}, targetSize: [8, 8] },
      run: { gpuDrawCalls: 0 },
      layout: { rows: { packedCount: 4 }, itemWordsHold: createDrawItemWordsHold(4) },
      context: {},
    } as unknown as WebgpuPagesRuntime
    encodeWebgpuVisibilityPasses(rt, {} as GPUDevice, encoder, true, true, null)
    return pipelines
  }
  // Layer 0, then a coplanar layer: its occluder set, the same cull ranks; each its opaque slots,
  // then its cutout ones with their face mode's pipeline.
  const twice = (faces: string[]) => [...faces, ...faces]
  const occluders = [
    ...twice(['back', 'none', 'front']),
    ...twice(['layer 0', 'layer 1', 'layer 2']),
  ]
  const twins = drawn(true)
  assert.deepEqual(twins['Trillion3D visibility primary'], occluders)
  assert.deepEqual(twins['Trillion3D visibility secondary'], occluders)
  const tested = [
    ...twice(['tested back', 'tested none', 'tested front']),
    ...twice(['layer 5', 'layer 6', 'layer 7']),
  ]
  assert.deepEqual(drawn(false)['Trillion3D visibility secondary'], tested)
})
