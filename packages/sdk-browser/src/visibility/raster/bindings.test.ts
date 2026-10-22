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
import { createShadowPrograms } from '../../lighting/shadows/vsm/tessellation/shadowPrograms.ts'
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
