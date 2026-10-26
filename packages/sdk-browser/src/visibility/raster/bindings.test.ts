import test from 'node:test'
import assert from 'node:assert/strict'
import { rasterOf } from './rasterFrame.fixture.ts'
import { TESS_PROGRAMS, tessLayoutEntries, type TessProgram } from '../tessellation/bindings.ts'
import { diceSource } from '../tessellation/diceWgsl.ts'
import { planSource } from '../tessellation/planWgsl.ts'
import { seedSource } from '../tessellation/seedWgsl.ts'
import { splitSource } from '../tessellation/splitWgsl.ts'
import { NO_MASKS } from '../../materials/graph/maskProgram.ts'
import { diceWpo, shadowSplitWpo, tessellationWpo } from '../shader/wpoSets.ts'
import { offsetting } from './offsetting.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { moduleCode } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { shadowPageLayout } from '../../lighting/shadows/casters/pageGroup.ts'
import { vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import { vsmRasterPipe } from '../../lighting/shadows/vsm/render/renderPipes.ts'
import { createShadowPrograms } from '../../lighting/shadows/vsm/tessellation/shadowPrograms.ts'
import { vsmMaskedPatches } from '../../lighting/shadows/vsm/tessellation/maskedPatches.ts'
import { vsmShadowTessellation } from '../../lighting/shadows/vsm/tessellation/shadowChain.ts'
import { createVsmResources } from '../../lighting/shadows/vsm/resources.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  vsmTessSeedSource,
  vsmTessSplitSource,
} from '../../lighting/shadows/vsm/tessellation/shadowKernelsWgsl.ts'

/** What the tessellation's programs are made of: each one's text, plain and over the offsets of a
 *  session (`offsetting`), and the group its kernels read. */
const TESSELLATION_PROGRAMS = {
  seed: [seedSource, () => seedSource(tessellationWpo(offsetting()))],
  plan: [planSource, planSource],
  split: [splitSource, () => splitSource(false, tessellationWpo(offsetting()))],
  dice: [diceSource, () => diceSource(NO_MASKS, diceWpo(offsetting()))],
} as const

test('each tessellation program binds what it declares, whatever offsets it holds, and only the arguments’ kernels bind the dispatch buffer', () => {
  for (const [name, [plain, offset]] of Object.entries(TESSELLATION_PROGRAMS)) {
    const program = name as TessProgram
    const bindings = (code: string) =>
      [...code.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1])).sort((a, b) => a - b)
    const entries = tessLayoutEntries(program)
    const layout = entries.map((entry) => entry.binding).sort((a, b) => a - b)
    // With every offset resource a kernel can read, it declares the layout's whole; without, a part.
    assert.deepEqual(bindings(offset()), layout, `${name}: the declared bindings are the layout's`)
    assert.ok(
      bindings(plain()).every((binding) => layout.includes(binding)),
      `${name}: the plain module declares nothing past the layout`,
    )
    // The compute stage of the poorest device WebGPU guarantees binds eight storage buffers.
    const storage = entries.filter((e) => e.buffer && e.buffer.type !== 'uniform').length
    assert.ok(storage <= 8, `${name} binds ${storage} storage buffers`)
  }
  // A buffer a dispatch reads its size from is never bound writable to that dispatch: the kernels
  // launched by it (`split`, `dice`) bind none, the kernels that write it launch nothing.
  const writers = Object.entries(TESS_PROGRAMS).filter(([, names]) => names.includes('dispatch'))
  assert.deepEqual(
    writers.map(([program]) => program),
    ['plan'],
  )
})

test('the splitting of the patches follows the project switch: the plane’s test is in its text only with it', () => {
  for (const clipping of [false, true]) {
    const code = splitSource(clipping)
    assert.equal(code.includes('uni.clipRoute!=0u&&boxBehindPlane'), clipping, `${clipping}`)
    assert.equal(code.includes('fn boxBehindPlane'), clipping, `${clipping}`)
  }
  // The raster hands the switch to the tessellation it holds: its splitting module is made over it.
  for (const clipping of [false, true]) {
    const { f, device, raster } = rasterOf(true, clipping)
    raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
    const split = f.computePipelines.find((p) => p.compute.entryPoint === 'tessSplit')!
    const code = moduleCode(split.compute.module)
    assert.equal(code.includes('uni.clipRoute!=0u&&boxBehindPlane'), clipping, `held ${clipping}`)
  }
})

test('the shadow maps’ programs declare the tessellation’s group as their layout lists it, and their pipelines stay within the eight storage buffers', async () => {
  const layout = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
  for (const [program, code] of [
    ['shadowSeed', vsmTessSeedSource()],
    ['shadowSplit', vsmTessSplitSource(layout, shadowSplitWpo(offsetting(false)))],
  ] as const) {
    const declared = [...code.matchAll(/@group\(0\) @binding\((\d+)\)/g)].map((m) => Number(m[1]))
    assert.deepEqual(
      declared.sort((a, b) => a - b),
      tessLayoutEntries(program)
        .map((entry) => entry.binding)
        .sort((a, b) => a - b),
      program,
    )
  }
  const { f, device } = rasterOf(true)
  const pageLayout = shadowPageLayout(device)
  const programs = createShadowPrograms(
    device,
    layout,
    pageLayout,
    vsmRasterPipe(device, layout, pageLayout).layout1,
  )
  assert.equal(programs.ask(), false, 'compiled off the frame, not ready at once')
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(programs.ask(), true)
  assert.deepEqual(
    f.computePipelines
      .flatMap((p) => p.compute.entryPoint ?? [])
      .filter((entry) => /^(tess|vsmTess)/.test(entry))
      .sort(),
    ['tessPlan', 'vsmTessDrawArgs', 'vsmTessSeed', 'vsmTessSeedArgs', 'vsmTessSplit'],
  )
  const draw = f.renderPipelines.find((p) => p.label === 'Trillion3D shadow tessellation raster')!
  assert.deepEqual(
    [draw.vertex.entryPoint, draw.fragment?.entryPoint],
    ['vsmTessellatedVs', 'vsmRenderFs'],
  )
  // The vertex stage binds the page group’s four, the pairs’ and the projections’, `tess` and the
  // data atlas’s page table: eight, no more.
  const groups = (draw.layout as unknown as { bindGroupLayouts: GPUBindGroupLayout[] })
    .bindGroupLayouts
  assert.equal(groups.length, 3)
  const storage = stageBindingCounts({ bindGroupLayouts: groups }).find(
    (c) => c.limit === 'maxStorageBuffersPerShaderStage' && c.kind.endsWith('Vertex'),
  )
  assert.equal(storage?.count, 8)
})

test('the shadow maps’ tessellation waits for its pipelines, then takes the kinds of light the settings ask', async () => {
  const { device, raster } = rasterOf(true)
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  const res = createVsmResources(device, { fullMapCapacity: 7, poolPages: 64 })
  const pageLayout = shadowPageLayout(device)
  const rtOf = (context: object) =>
    ({
      context,
      vis: {
        gpuRaster: raster,
        materialTable: { displaced: { count: 1, ints: new Uint32Array(16), version: 1 }, view: {} },
        graphFrame: { bufferOn: () => ({}) },
        ...{
          concatPos: {},
          concatUv: {},
          concatNrm: {},
          pageTable: {},
          textures: {},
          mapsSampler: {},
        },
      },
      gpu: { cache: { buffer: {} }, device },
      // The decoded clusters of the casters the shadow raster draws (`frameGeometry`).
      lights: { casters: { pages: {} } },
      run: { selectionUniforms: { pixelError: 1 } },
    }) as unknown as WebgpuPagesRuntime
  const vsm = { res, renderedPlan: 'plan' as unknown }
  const ask = (context: object) => vsmShadowTessellation(rtOf(context), device, vsm, pageLayout)
  // Its pipelines asked, the maps are drawn flat and the frame is not drawn as far as the cache goes,
  // to draw them again.
  assert.equal(ask({}), undefined)
  assert.equal(vsm.renderedPlan, undefined)
  await new Promise((done) => setTimeout(done, 0))
  // Ready: both kinds of light take it by default, one alone when the other's setting is off.
  vsm.renderedPlan = 'plan'
  assert.equal(ask({})?.kinds, 3)
  assert.equal(ask({ tessellationShadowsLocal: false })?.kinds, 1)
  assert.equal(ask({ tessellationShadowsDirectional: false })?.kinds, 2)
  assert.equal(vsm.renderedPlan, 'plan', 'drawn whole')
  // Both off, or the tessellation off: nothing is asked and nothing waits.
  for (const context of [
    { tessellationShadowsDirectional: false, tessellationShadowsLocal: false },
    { tessellation: false },
  ])
    assert.equal(ask(context), undefined, JSON.stringify(context))
  assert.equal(vsm.renderedPlan, 'plan', 'nothing waits')
})

test('a device that grants nine storage buffers a stage cuts a masked row out at the shadow patches’ vertices, one at eight leaves it to the fragment', async () => {
  const layout = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
  const made = async (storage: number, vertexStage?: number) => {
    const fake = fakeDevice({
      limits: {
        maxStorageBuffersPerShaderStage: storage,
        ...(vertexStage !== undefined && { maxStorageBuffersInVertexStage: vertexStage }),
      },
    })
    const device = fake.device as unknown as GPUDevice
    const pageLayout = shadowPageLayout(device)
    const programs = createShadowPrograms(
      device,
      layout,
      pageLayout,
      vsmRasterPipe(device, layout, pageLayout).layout1,
    )
    programs.ask()
    await new Promise((done) => setTimeout(done, 0))
    const draw = fake.renderPipelines.find(
      (p) => p.label === 'Trillion3D shadow tessellation raster',
    )!
    const code = moduleCode(draw.vertex.module)
    const groups = (draw.layout as unknown as { bindGroupLayouts: GPUBindGroupLayout[] })
      .bindGroupLayouts
    const vertex = stageBindingCounts({ bindGroupLayouts: groups }).find(
      (c) => c.limit === 'maxStorageBuffersPerShaderStage' && c.kind.endsWith('Vertex'),
    )
    return { programs, code, storage: vertex?.count, device }
  }
  const [eight, nine] = [await made(8), await made(9)]
  assert.deepEqual([vsmMaskedPatches(eight.device), vsmMaskedPatches(nine.device)], [false, true])
  // The vertex stage's own limit decides where the device has one: nine a stage, eight of them in the
  // vertex stage, a cutout by the fragment; nine in both, one at the vertices.
  assert.deepEqual(
    [await made(9, 8), await made(9, 9)].map(({ device }) => vsmMaskedPatches(device)),
    [false, true],
  )
  // The ninth buffer is the colour atlas's page table, in the tessellation's group of the vertex stage;
  // the cutout's functions and the colour atlas are in its text, and in no other.
  assert.deepEqual([eight.storage, nine.storage], [8, 9])
  assert.deepEqual(
    [eight.programs.rasterProgram, nine.programs.rasterProgram],
    ['shadowRaster', 'shadowRasterMasked'],
  )
  assert.deepEqual(
    [eight.code, nine.code].map(
      (code) => code.includes('dicedKept(') && code.includes('colorPages'),
    ),
    [false, true],
  )
  // Without the colour atlas the stage hands the fragment the point's coordinate and the row's flag,
  // which the casters' own fragment judges; with it, the cutout is the vertices' and no fragment's.
  assert.deepEqual(
    [eight.code, nine.code].map((code) => code.includes('out.masked=1u;')),
    [true, false],
  )
  // The group the vertex stage reads names the colour atlas on that device alone.
  const colour = (program: 'shadowRaster' | 'shadowRasterMasked') =>
    tessLayoutEntries(program).some((entry) => entry.binding === 9)
  assert.deepEqual([colour('shadowRaster'), colour('shadowRasterMasked')], [false, true])
})
