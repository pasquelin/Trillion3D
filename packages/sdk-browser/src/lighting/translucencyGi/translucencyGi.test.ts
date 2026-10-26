// The translucency global illumination volume (`./`): the grid's law and its jitter, the harmonics the cones are projected on and the surfaces
// read, the programs' bindings against their layouts, and the kernels within WebGPU's default limits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TRANSLUCENCY_GI_RULES } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { withinDefaults } from '../../gpu/core/stageLimits.fixture.ts'
import { FILTER_GI_PROGRAM } from './filterWgsl.ts'
import { INTEGRATE_GI_PROGRAM } from './integrateWgsl.ts'
import { GI_LIGHT_WGSL } from './frameWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { TRACE_GI_PROGRAM, TRACE_GI_BINDINGS } from './traceWgsl.ts'
import { MARK_GI_PROGRAM } from './markWgsl.ts'
import { pipelinesSettled } from '../deferred/compileLedger.ts'
import { translucencyGiKernels } from './kernels.ts'
import { writeGiFrame, type TranslucencyGiState } from './gpu.ts'
import {
  TRANSLUCENCY_GI_FRAME,
  traceExtent,
  translucencyGiFootprintLevel,
  translucencyGiGrid,
  translucencyGiJitter,
  giSlotSide,
  TRANSLUCENCY_GI_SLOT_SIDE,
  volumeExtent,
} from './layout.ts'

const values = resolveSettings(TRANSLUCENCY_GI_RULES, {})

test('the grid is the reference’s: cells of 32 pixels, slices on the logarithm of the distance out to 80 metres', () => {
  const grid = translucencyGiGrid(values, 1920, 1080, 0.1)
  assert.deepEqual([grid.x, grid.y, grid.z, grid.shift], [60, 34, 26, 5])
  assert.deepEqual([grid.logZScale, grid.logZOffset, grid.zScale], [1, 1, 4])
  assert.deepEqual(traceExtent(grid, 3), [180, 102, 26])
  assert.deepEqual(volumeExtent(grid), [60, 34, 52])
  // A cell side that is not a power of two counts the cells by the side, the pyramid’s level by its logarithm.
  const odd = translucencyGiGrid({ ...values, translucencyGiGridPixelSize: 48 }, 1920, 1080, 0.1)
  assert.deepEqual([odd.x, odd.y, odd.shift], [40, 23, 5])
  // A cell’s footprint is read in the pyramid’s texel two cells across (the reference’s mip, half the image’s size, one level above the cell’s), four where a cell is a pixel.
  assert.deepEqual([5, 1, 0].map(translucencyGiFootprintLevel), [6, 2, 2])
  // No span, one slice.
  assert.equal(translucencyGiGrid({ ...values, translucencyGiEndDistance: 0.05 }, 64, 64, 0.1).z, 1)
})

test('the jitter turns through the Halton sequence, or rests at the cell’s centre', () => {
  const out = new Float32Array(4)
  translucencyGiJitter(values, 3, out, 0)
  // Halton bases 2, 3 and 5 at the image's rank, the directions' turn its rank.
  const near = (got: number, want: number) =>
    assert.ok(Math.abs(got - want) < 1e-6, `${got} ${want}`)
  near(out[0], 0.75)
  near(out[1], 1 / 9)
  near(out[2], 0.6)
  assert.equal(out[3], 3)
  translucencyGiJitter({ ...values, translucencyGiTemporalJitter: false }, 3, out, 0)
  assert.deepEqual([...out], [0.5, 0.5, 0.5, -1])
  // The directions come round after `translucencyGiTemporalMaxRayDirections` images.
  translucencyGiJitter(values, 8, out, 0)
  assert.equal(out[3], 0)
})

test('a slice and its depth are each other’s inverse', () => {
  const run = shaderRun<{
    giDepthOfSlice: (slice: number) => number
    giSliceOfDepth: (depth: number) => number
  }>(INTEGRATE_GI_PROGRAM, ['giDepthOfSlice', 'giSliceOfDepth'], {
    gi: { zParams: [1, 1, 4, 0.1] },
  })
  for (const depth of [0.1, 1, 7.5, 80]) {
    const slice = run.giSliceOfDepth(depth)
    assert.ok(Math.abs(run.giDepthOfSlice(slice) - depth) < 1e-4 * depth)
  }
  // The end distance is the last slice: 26 slices from the near plane.
  assert.ok(Math.abs(run.giSliceOfDepth(80) - 4 * Math.log2(81)) < 1e-5)
})

test('a constant radiance projected on the harmonics gives its irradiance back: π times the radiance', () => {
  const radiance = 2
  const run = shaderRun<{
    giProject: (cell: number[]) => { c: number[][] }
  }>(INTEGRATE_GI_PROGRAM, ['giProject'], {
    gi: { trace: [3, 20, 1, 1] },
    cones: { load: () => [radiance, radiance, radiance, 0] },
  })
  // The surfaces' reading of the harmonics, the block the blends' fragment stage reads them by
  // (`readWgsl.ts`).
  const read = shaderRun<{
    giIrradiance: (light: number[][], N: number[], single: boolean) => number[]
  }>(wgslModule(GI_LIGHT_WGSL), ['giIrradiance'], {})
  const sh = run.giProject([0, 0, 0])
  // The constant band is exact: four π times the radiance times the band’s basis, the factor four being the one the reading takes out.
  assert.ok(Math.abs(sh.c[0][0] - 4 * Math.PI * radiance * 0.282095) < 1e-4)
  const luminance = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const light = [sh.c[0], [1, 2, 3].map((k) => luminance(sh.c[k]))]
  // The nine cones of a cell stand at the centres of the texels of the equal-area octahedron, one of them on the pole +z and none on -z: their
  // linear bands do not cancel along z, as the reference’s do not. Across the horizon they do, and the irradiance is π times the radiance.
  for (const N of [
    [0.6, 0.8, 0],
    [1, 0, 0],
    [0, -1, 0],
  ]) {
    const E = read.giIrradiance(light, N, false)
    E.forEach((c) =>
      assert.ok(Math.abs(c - Math.PI * radiance) < 0.02 * Math.PI * radiance, `${E}`),
    )
  }
  // Asked for the constant band alone, a surface reads the same under a constant sky, whatever its normal.
  for (const N of [
    [0, 0, 1],
    [0, 0, -1],
  ]) {
    const flat = read.giIrradiance(light, N, true)
    flat.forEach((c) => assert.ok(Math.abs(c - Math.PI * radiance) < 0.02 * Math.PI * radiance))
  }
})

test('the frame the passes read has one layout: the struct and its words', () => {
  assert.equal(TRANSLUCENCY_GI_FRAME.words % 4, 0)
  assert.equal(TRANSLUCENCY_GI_FRAME.at.previous % 4, 0)
  assert.match(TRANSLUCENCY_GI_FRAME.wgsl, /previous:mat4x4f/)
  assert.match(TRANSLUCENCY_GI_FRAME.wgsl, /eyeMoved:vec4f/)
})

test('the history is carried by the eye’s travel, taken in double precision', () => {
  let words = new Float32Array(0)
  const device = {
    queue: {
      writeBuffer: (_: unknown, __: number, data: ArrayBuffer) =>
        (words = new Float32Array(data.slice(0))),
    },
  } as unknown as GPUDevice
  const state = {
    resources: { frame: {} },
    previous: new Float32Array(16),
    previousEye: Float64Array.of(1e6, 2e6, -3e6),
  } as unknown as TranslucencyGiState
  const image = {
    width: 64,
    height: 64,
    near: 0.1,
    preExposure: 1,
    frame: 0,
    history: true,
    eye: [1e6 + 0.25, 2e6, -3e6 + 0.5],
    viewProjection: new Float32Array(16),
    inverse: new Float32Array(16),
  }
  writeGiFrame(device, state, translucencyGiGrid(values, 64, 64, 0.1), values, image, false)
  const at = TRANSLUCENCY_GI_FRAME.at.eyeMoved
  // Single precision holds a million to a sixteenth: the travel is the difference of the doubles, not of two rounded eyes.
  assert.deepEqual([...words.slice(at, at + 3)], [0.25, 0, 0.5])
})

test('the programs bind the textures and buffers their layouts name, and nothing twice', () => {
  for (const [name, text] of [
    ['mark', MARK_GI_PROGRAM],
    ['trace', TRACE_GI_PROGRAM],
    ['filter', FILTER_GI_PROGRAM],
    ['integrate', INTEGRATE_GI_PROGRAM],
  ] as const) {
    const bound = [...text.matchAll(/@group\((\d+)\) @binding\((\d+)\)/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    )
    assert.equal(new Set(bound).size, bound.length, `${name}: a binding twice`)
  }
  assert.equal(TRACE_GI_BINDINGS.at.frame, 1)
})

test('the kernels fit WebGPU’s default limits and are built on their layouts', async () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  // The kernels are asked of the device as a frame asks them, off the frame, and awaited as the frame gate awaits them.
  assert.equal(translucencyGiKernels(device), undefined)
  await pipelinesSettled(device)
  const kernels = translucencyGiKernels(device)!
  assert.deepEqual(Object.keys(kernels).sort(), ['filter', 'integrate', 'mark', 'trace'])
  withinDefaults(layouts, 'the translucency global illumination volume')
})

test('a trace workgroup’s block of cone texels touches no more cells a side than the slots it shares them in', () => {
  // One cone a cell shares nothing (a thread a cell); from two a side, the block is within the slots at every size the setting allows.
  for (let tracing = 2; tracing <= 16; tracing++)
    assert.ok(giSlotSide(tracing) <= TRANSLUCENCY_GI_SLOT_SIDE, `${tracing}`)
  assert.equal(
    Math.max(...Array.from({ length: 15 }, (_, k) => giSlotSide(k + 2))),
    TRANSLUCENCY_GI_SLOT_SIDE,
  )
})
