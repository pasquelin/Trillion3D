// S19.5: the tested half draws after its compaction, which removed every row the pyramid rejected
// (`../../gpu/raster/restCompactEquivalence.test.ts`: no rejected instance is drawn). Every row
// left passes the verdict the tested vertex stage reads again, so a compacted tested slot draws
// with its occluder twin — the same states, `vis_vs` —; without a compaction, the verdict read
// (`vis_hiz_vs`) stays the fallback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { functionsOf } from '../../texture/shaderRule.fixture.ts'
import { VIS_SHADER } from '../../visibility/shader/visWgsl.ts'
import { BASE_SLOTS } from '../../gpu/draw/draw.ts'
import { createGpuRestCompact } from '../../gpu/raster/restCompact.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { createWebgpuVisibilityRasterPipelines } from './pipelines.ts'
import { encodeWebgpuVisibilityPasses } from './passes.ts'
import { createDrawItemWordsHold } from './itemWords.ts'
import { createWebgpuVisState } from '../pages/state/vis.ts'
import { commandArgs } from '../../../../../tests/kit/gpu/mockRenderPass.ts'

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
  // A buffer a role: an indirect buffer is never bound writable in its own dispatch.
  const buffer = (label: string) =>
    fake.device.createBuffer({
      label,
      size: 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    })
  const compact = (await createGpuRestCompact(fake.device, {
    state: buffer('state'),
    perRow: 4,
    instances: buffer('instances'),
    indirect: buffer('indirect'),
    slotOffsets: buffer('slot offsets'),
    flags: buffer('flags'),
  }))!
  const open = { pass: fake.device.createCommandEncoder().beginComputePass() },
    rows = buffer('rows')
  assert.equal(compact.encode(open, 3, 0, rows), false)
  assert.equal(compact.encode(open, 0, 5, rows), false)
  assert.equal(fake.dispatches.length, 0)
  // Arguments, count, scan, scatter: four dispatches of the frame's pass, none of its own.
  assert.equal(compact.encode(open, 3, 5, rows), true)
  assert.equal(fake.dispatches.length, 4)
  compact.dispose()
  assert.equal(compact.encode(open, 3, 5, rows), false)
})

/** Each pipeline as a name: layer 0's own, then each coplanar layer's three culls, occluders first. */
const PIPELINES = {
  visPipelineBack: 'back',
  visPipelineNone: 'none',
  visPipelineFront: 'front',
  visHizRestBack: 'tested back',
  visHizRestNone: 'tested none',
  visHizRestFront: 'tested front',
  visLayerPipelines: Array.from({ length: 6 }, (_, i) => `layer ${i}`),
}

test('the secondary pass draws with the occluder twins exactly when the compaction ran', () => {
  const drawn = (compacted: boolean) => {
    const fake = fakeDevice()
    const indirectBuffer = fake.device.createBuffer({
      size: 1 << 16,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE,
    })
    const rt = {
      vis: {
        visView: {},
        pageTable: {},
        drawLayerSlots: 2,
        visBindGroupLayout: {},
        zeroFlags: {},
        visSlotGroups: new Array(4 * BASE_SLOTS).fill({}),
        gpuDraw: { indirectBuffer },
        gpuHiz: { level0View: {}, flags: {}, encodePyramid() {}, encodeTest() {} },
        gpuPartition: { counting: false },
        gpuRestCompact: { encode: () => compacted },
        visBundles: createWebgpuVisState().visBundles,
        ...PIPELINES,
      },
      gpu: { depthView: {}, targetSize: [8, 8] },
      run: { gpuDrawCalls: 0 },
      layout: { rows: { packedCount: 4 }, itemWordsHold: createDrawItemWordsHold(4) },
      context: {},
    } as unknown as WebgpuPagesRuntime
    encodeWebgpuVisibilityPasses(rt, fake.device, fake.device.createCommandEncoder(), true, null)
    // The pipelines each pass label set, in order; a label begun again keeps its last pass's.
    return Object.fromEntries(
      fake.passes.map(({ label, commands }) => [
        label!,
        commandArgs(commands, 'setPipeline').map(([pipeline]) => pipeline),
      ]),
    )
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
    ...twice(['layer 3', 'layer 4', 'layer 5']),
  ]
  assert.deepEqual(drawn(false)['Trillion3D visibility secondary'], tested)
})
