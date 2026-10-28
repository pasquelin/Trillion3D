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
import { moduleCode } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { wgslBindingNumbers } from '../../gpu/core/wgslBindings.fixture.ts'
import { stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { shadowPageLayout } from '../../lighting/shadows/casters/pageGroup.ts'
import { createShadowPrograms } from '../../lighting/shadows/vsm/tessellation/shadowPrograms.ts'
import {
  VSM_TESS_DICE_TESS_GROUP,
  vsmTessDiceWgsl,
} from '../../lighting/shadows/vsm/tessellation/shadowDiceWgsl.ts'
import { vsmShadowTessellation } from '../../lighting/shadows/vsm/tessellation/shadowChain.ts'
import { shadowLodScale } from '../../lighting/shadows/vsm/frame/shadowLodScale.ts'
import { createVsmResources } from '../../lighting/shadows/vsm/resources.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { vsmTessSource } from '../../lighting/shadows/vsm/tessellation/shadowKernelsWgsl.ts'
import { SUNS_LAYOUT } from '../../lighting/shadows/vsm/layout.fixture.ts'

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
  const layout = SUNS_LAYOUT
  // The one module of the seeding, the resume and the splitting, over the offsets of a session.
  const code = vsmTessSource(layout, shadowSplitWpo(offsetting(false)))
  assert.deepEqual(
    wgslBindingNumbers(code),
    tessLayoutEntries('shadowSplit')
      .map((entry) => entry.binding)
      .sort((a, b) => a - b),
    'the patches’ module declares the shadowSplit group',
  )
  // The dicing declares the tessellation’s group as its layout lists it, in the group it binds it in.
  const dicing = vsmTessDiceWgsl(layout)
  assert.deepEqual(
    wgslBindingNumbers(dicing, VSM_TESS_DICE_TESS_GROUP),
    tessLayoutEntries('shadowDice')
      .map((entry) => entry.binding)
      .sort((a, b) => a - b),
    'the dicing declares the shadowDice group',
  )
  const { f, device } = rasterOf(true)
  const programs = createShadowPrograms(device, layout)
  assert.equal(programs.ask(), false, 'compiled off the frame, not ready at once')
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(programs.ask(), true)
  assert.deepEqual(
    f.computePipelines
      .flatMap((p) => p.compute.entryPoint ?? [])
      .filter((entry) => /^(tess|vsmTess)/.test(entry))
      .sort(),
    [
      'tessPlan',
      'vsmTessDice0',
      'vsmTessDice1',
      'vsmTessResume',
      'vsmTessSeed',
      'vsmTessSeedArgs',
      'vsmTessShadowArgs',
      'vsmTessSplit',
      'vsmTessWindowFill',
    ],
  )
  // No displaced surface is given the hardware path: no render pipeline draws the patches.
  assert.deepEqual(
    f.renderPipelines.filter((p) => p.label?.startsWith('Trillion3D shadow tessellation')),
    [],
  )
  // The dicing binds the page group’s five storage buffers, `tess` and the data atlas’s page table and
  // the pool’s slice: eight, no more; the windows’ fill and the arguments fewer.
  const storage = (entry: string) => {
    const pipeline = f.computePipelines.find((p) => p.compute.entryPoint === entry)!
    const groups = (pipeline.layout as unknown as { bindGroupLayouts: GPUBindGroupLayout[] })
      .bindGroupLayouts
    return stageBindingCounts({ bindGroupLayouts: groups }).find(
      (c) => c.limit === 'maxStorageBuffersPerShaderStage' && c.kind.endsWith('Compute'),
    )?.count
  }
  assert.deepEqual([storage('vsmTessDice0'), storage('vsmTessDice1')], [8, 8])
  assert.ok(storage('vsmTessWindowFill')! <= 8)
  // It cuts a masked row out at the vertices of its micro-triangles, with the colour atlas of the page
  // group, whatever the device grants.
  assert.ok(dicing.includes('dicedKept(') && dicing.includes('colorPages'))
})

test('the shadow maps’ tessellation waits for its pipelines, then takes the kinds of light the settings ask', async () => {
  const { device, raster } = rasterOf(true)
  raster.followTessellation(device, { candidate: 1000, visible: 1000, records: 192 })
  const res = createVsmResources(device, { coverMode: 'suns', fullMapCapacity: 7, poolPages: 64 })
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
      run: { selectionUniforms: { pixelError: 1 }, gate: { pixelError: 1 } },
      services: { residency: { qualityScale: 1 } },
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
  // The patches' factors take the one scale of the shadows' level of detail (`shadowLodScale`).
  const { shadow } = raster.tessellation!
  const prepare = shadow.prepare
  const scales: number[] = []
  shadow.prepare = (...given: Parameters<typeof prepare>) => {
    scales.push(given[3])
    prepare(...given)
  }
  const context = { shadowGeometryLodBias: 3 }
  ask(context)
  assert.deepEqual(scales, [shadowLodScale(rtOf(context))])
  assert.equal(scales[0], 0.125)
})
