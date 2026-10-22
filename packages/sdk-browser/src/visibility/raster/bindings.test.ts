import test from 'node:test'
import assert from 'node:assert/strict'
import { createRasterBindings } from './bindings.ts'
import { binLayoutEntries } from './binWgsl.ts'
import { lazyTessellatedBin, stagesOf } from './binStages.ts'
import { rasterOf } from './rasterFrame.fixture.ts'
import type { GpuRasterInput } from './types.ts'
import { RASTER_PASS_MAIN, RASTER_PASS_POST } from './contract.ts'
import { TESS_PROGRAMS, tessLayoutEntries, type TessProgram } from '../tessellation/bindings.ts'
import { diceSource } from '../tessellation/diceWgsl.ts'
import { planSource } from '../tessellation/planWgsl.ts'
import { seedSource } from '../tessellation/seedWgsl.ts'
import { splitSource } from '../tessellation/splitWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { shadowPageLayout } from '../../lighting/shadows/casters/pageGroup.ts'
import { vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import { vsmRasterPipe } from '../../lighting/shadows/vsm/render/renderPipes.ts'
import {
  createShadowPrograms,
  vsmMaskedPatches,
} from '../../lighting/shadows/vsm/tessellation/shadowPrograms.ts'
import { vsmShadowTessellation } from '../../lighting/shadows/vsm/tessellation/shadowChain.ts'
import { createVsmResources } from '../../lighting/shadows/vsm/resources.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  vsmTessSeedSource,
  vsmTessSplitSource,
} from '../../lighting/shadows/vsm/tessellation/shadowKernelsWgsl.ts'

test('the binning compares its bound mask even when its selection owner stays', () => {
  const { device, bindGroups } = fakeDevice()
  const layout = {} as GPUBindGroupLayout
  const { bin } = createRasterBindings(device, { raster: layout, bin: layout }, {} as GPUBuffer)
  const input = { selection: { maskBuffer: {} } } as unknown as GpuRasterInput
  const first = bin(input, RASTER_PASS_MAIN)
  assert.equal(bin(input, RASTER_PASS_MAIN), first)
  input.selection!.maskBuffer = {} as GPUBuffer
  assert.notEqual(bin(input, RASTER_PASS_MAIN), first)
  const second = bin(input, RASTER_PASS_POST)
  bin(input, RASTER_PASS_MAIN)
  assert.equal(bin(input, RASTER_PASS_POST), second, 'switching a pass does not remake its group')
  // The hardware raster's group, made with the bindings, then the binning's three.
  assert.equal(bindGroups.length, 4)
})

/** What the tessellation's programs are made of: each one's text and the group its kernels read. */
const TESSELLATION_PROGRAMS = {
  seed: seedSource,
  plan: planSource,
  split: splitSource,
  dice: diceSource,
}

test('each tessellation program binds what it declares, and only the arguments’ kernels bind the dispatch buffer', () => {
  for (const [name, source] of Object.entries(TESSELLATION_PROGRAMS)) {
    const program = name as TessProgram
    const declared = [...source().matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]))
    const entries = tessLayoutEntries(program)
    assert.deepEqual(
      declared.sort((a, b) => a - b),
      entries.map((entry) => entry.binding).sort((a, b) => a - b),
      `${name}: the declared bindings are the layout's`,
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

test('the project switch picks the split’s text once: none of the plane’s code without it, all of it with it', async () => {
  const splits = async (clipping: boolean) => {
    const { f, frame } = rasterOf(false, clipping)
    // Compiled off the frame, which then finds them made.
    await new Promise((done) => setTimeout(done, 0))
    frame()
    return f.computePipelines
      .filter((p) => p.compute.entryPoint === 'bin')
      .map((p) => (p.compute.module as { code: string }).code)
  }
  const [off, on] = [await splits(false), await splits(true)]
  // A pipeline each pass, in both: the split of the view with a plane is no second one.
  assert.equal(off.length, 2)
  assert.equal(on.length, 2)
  assert.ok(off.every((code) => !code.includes('behind<') && !code.includes('uni.clipRoute')))
  assert.ok(on.every((code) => code.includes('behind<0.0') && code.includes('uni.clipRoute!=0u')))
})

test('the split that leaves the displaced rows to the tessellation follows the project switch too', () => {
  const { device } = fakeDevice(),
    codes: string[] = []
  const make = device.createShaderModule.bind(device)
  device.createShaderModule = (d) => (codes.push(d.code), make(d))
  const layout = device.createBindGroupLayout({ entries: binLayoutEntries() })
  const stages = stagesOf(device, [0, 0])
  for (const clipping of [false, true]) lazyTessellatedBin(device, 4096, clipping, layout, stages)()
  assert.equal(codes.length, 2)
  assert.ok(codes.every((code) => code.includes('tessellatedRow(page)')))
  assert.deepEqual(
    codes.map((code) => code.includes('behind<0.0')),
    [false, true],
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
    const code = (split.compute.module as { code: string }).code
    assert.equal(code.includes('uni.clipRoute!=0u&&boxBehindPlane'), clipping, `held ${clipping}`)
  }
})

test('the shadow maps’ programs declare the tessellation’s group as their layout lists it, and their pipelines stay within the eight storage buffers', async () => {
  const layout = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
  for (const [program, code] of [
    ['shadowSeed', vsmTessSeedSource()],
    ['shadowSplit', vsmTessSplitSource(layout)],
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
      .map((p) => p.compute.entryPoint)
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
        materialTable: { displaced: { count: 1, ints: new Uint32Array(16), version: 1 } },
        ...{
          concatPos: {},
          concatUv: {},
          concatNrm: {},
          pageTable: {},
          textures: {},
          mapsSampler: {},
        },
      },
      gpu: { cache: { buffer: {} } },
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

test('a device that grants nine storage buffers a stage cuts a masked row out in the shadow patches, one at eight draws it flat', async () => {
  const layout = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
  const made = async (storage: number) => {
    const fake = fakeDevice({ limits: { maxStorageBuffersPerShaderStage: storage } })
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
    const code = (draw.vertex.module as unknown as { code: string }).code
    const groups = (draw.layout as unknown as { bindGroupLayouts: GPUBindGroupLayout[] })
      .bindGroupLayouts
    const vertex = stageBindingCounts({ bindGroupLayouts: groups }).find(
      (c) => c.limit === 'maxStorageBuffersPerShaderStage' && c.kind.endsWith('Vertex'),
    )
    return { programs, code, storage: vertex?.count, device }
  }
  const [eight, nine] = [await made(8), await made(9)]
  assert.deepEqual([vsmMaskedPatches(eight.device), vsmMaskedPatches(nine.device)], [false, true])
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
  // The group the vertex stage reads names the colour atlas on that device alone.
  const colour = (program: 'shadowRaster' | 'shadowRasterMasked') =>
    tessLayoutEntries(program).some((entry) => entry.binding === 9)
  assert.deepEqual([colour('shadowRaster'), colour('shadowRasterMasked')], [false, true])
})
