// The overdraw view's slice of the pool: made only with a layout that asks it, counted into by the hardware fragment and the software raster, read by the views' kernels, cleared with the frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VIRTUAL_SHADOW_MAP_VIEWS } from '../../../../../sdk-core/src/runtime/diagnostics.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { device } from './prefilteredBuffers.fixture.ts'
import { vsmLayout } from './layout.ts'
import { VSM_OVERDRAW_SLICE, VSM_POOL_SLICES } from './constants.ts'
import { vsmResourceBytes, poolSliceBytes } from './layoutBytes.ts'
import {
  createVsmResources,
  vsmBindGroupEntries,
  vsmBindingsWgsl,
  type VsmBindingSpec,
} from './resources.ts'
import {
  vsmRenderCountWgsl,
  vsmRenderFragmentSpecs,
  vsmRenderRasterWgsl,
} from './render/renderRasterWgsl.ts'
import { vsmRenderVoxelWgsl } from './render/renderVoxelWgsl.ts'
import { vsmRenderSoftwareWgsl, vsmSoftwareSpecs } from './render/renderSoftwareWgsl.ts'
import { vsmSoftwareOverdraw } from './render/renderParamsWgsl.ts'
import { vsmProjectionRegionWgsl } from './projection/projectionRegionWgsl.ts'
import {
  VSM_VISUALIZE_OVERDRAW_OUTPUT_WGSL,
  vsmVisualizeLocalsWgsl,
  vsmVisualizePerLightWgsl,
  vsmVisualizeSpecs,
  vsmVisualizeSunsWgsl,
} from './projection/visualizeWgsl.ts'

const MAPS = { coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 35 } as const
const OFF = vsmLayout(MAPS)
const ON = vsmLayout({ ...MAPS, overdraw: true })

test('the view is a mode of the views, a bit of its own', () => {
  const ids = Object.values(VIRTUAL_SHADOW_MAP_VIEWS)
  assert.equal(VIRTUAL_SHADOW_MAP_VIEWS['virtual-shadow-map-overdraw'], 1024)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every((id) => (id & (id - 1)) === 0))
})

test('only a layout that asks it makes the slice, a pool slice of the same bytes after the two', () => {
  assert.equal(OFF.overdraw, false)
  assert.equal(ON.overdraw, true)
  assert.equal(VSM_OVERDRAW_SLICE, VSM_POOL_SLICES)
  const plain = device()
  assert.equal(createVsmResources(plain.device, MAPS).pagePool.length, VSM_POOL_SLICES)
  const fake = device()
  const res = createVsmResources(fake.device, { ...MAPS, overdraw: true })
  assert.equal(res.pagePool.length, VSM_POOL_SLICES + 1)
  assert.equal(res.pagePool[VSM_OVERDRAW_SLICE]!.size, poolSliceBytes(ON))
  assert.equal(vsmResourceBytes(ON) - vsmResourceBytes(OFF), poolSliceBytes(ON))
})

test('the slice is bound by its own spec and counted or read by name', () => {
  const counting: VsmBindingSpec = { resource: 'overdrawSlice', binding: 7, access: 'atomic' }
  const reading: VsmBindingSpec = { resource: 'overdrawSlice', binding: 6 }
  const add = wgslSource(vsmBindingsWgsl(1, [counting], ON))
  assert.match(
    add,
    /@group\(1\) @binding\(7\) var<storage,read_write> vsmOverdraw:array<atomic<u32>>;/,
  )
  assert.match(
    add,
    /fn vsmOverdrawAdd\(t:vec2u\)\{atomicAdd\(&vsmOverdraw\[vsmOverdrawTexelIndex\(t\)\],1u\);\}/,
  )
  const load = wgslSource(vsmBindingsWgsl(1, [reading], ON))
  assert.match(load, /@binding\(6\) var<storage,read> vsmOverdraw:array<u32>;/)
  assert.match(load, /fn vsmOverdrawLoad\(t:vec2u\)->u32/)
  const res = createVsmResources(device().device, { ...MAPS, overdraw: true })
  assert.deepEqual(vsmBindGroupEntries(res, [counting]), [
    { binding: 7, resource: { buffer: res.pagePool[VSM_OVERDRAW_SLICE] } },
  ])
})

test('the hardware fragment counts after the page test and before the depth, in the casters’ and the voxels’ tiers', () => {
  assert.equal(
    vsmRenderFragmentSpecs(OFF).some((s) => s.resource === 'overdrawSlice'),
    false,
  )
  assert.equal(vsmRenderFragmentSpecs(ON).at(-1)?.resource, 'overdrawSlice')
  assert.match(vsmRenderCountWgsl(ON).text, /vsmOverdrawAdd\(texel\)/)
  assert.doesNotMatch(vsmRenderCountWgsl(OFF).text, /vsmOverdrawAdd/)
  for (const make of [vsmRenderRasterWgsl, vsmRenderVoxelWgsl]) {
    const code = make(ON)
    assertProgramAssembles(code, 'vsmRenderFs', 'the fragment with the slice')
    assert.match(code, /var<storage,read_write> vsmOverdraw:/)
    assert.match(code, /discard;\}\n vsmRenderCount\(texel\);\n/)
    const plain = make(OFF)
    assertProgramAssembles(plain, 'vsmRenderFs', 'the fragment without it')
    assert.doesNotMatch(plain, /vsmOverdraw[A-Z]?[a-z]*:|atomicAdd/)
  }
})

test('the software raster counts every covered pixel of a drawn page before its tests, where the stage has the buffer', () => {
  const code = vsmRenderSoftwareWgsl(ON, undefined, undefined, false, false, false, true)
  assertProgramAssembles(code, 'vsmRenderSoftware', 'with the slice')
  assert.match(code, /vsmOverdrawAdd\(texel\);\n let slice=0u;/)
  assert.equal(vsmSoftwareSpecs(false, false, true).at(-1)?.resource, 'overdrawSlice')
  assert.equal(vsmSoftwareSpecs(true, true, true).at(-1)?.binding, 7)
  assert.doesNotMatch(vsmRenderSoftwareWgsl(OFF), /vsmOverdraw/)
  // The eight storage buffers every device has, one more for the second pool slice, one for the projection data, one for the slice.
  const limits = (maxStorageBuffersPerShaderStage: number) =>
    ({ limits: { maxStorageBuffersPerShaderStage } }) as unknown as Pick<GPUDevice, 'limits'>
  assert.deepEqual(
    [8, 9, 10, 11, 12].map((n) => vsmSoftwareOverdraw(limits(n), true)),
    [false, false, false, true, true],
  )
  assert.equal(vsmSoftwareOverdraw(limits(16), false), false)
})

test('the views read the slice in the place of the page records, with no back-face cull', () => {
  assert.equal(vsmVisualizeSpecs(OFF).at(-1)?.resource, 'poolPageInfo')
  assert.deepEqual(vsmVisualizeSpecs(ON).at(-1), { resource: 'overdrawSlice', binding: 6 })
  assert.equal(vsmVisualizeSpecs(ON).length, vsmVisualizeSpecs(OFF).length)
  assert.doesNotMatch(vsmProjectionRegionWgsl('gbuffer', false), /cullBackfacing/)
  assert.match(vsmProjectionRegionWgsl('gbuffer'), /cullBackfacing/)
  const output = VSM_VISUALIZE_OVERDRAW_OUTPUT_WGSL.text
  assert.doesNotMatch(output, /`/)
  assert.match(output, /count=vsmOverdrawLoad\(seen\.poolTexel\)/)
  assert.match(output, /select\(accumulator\.x,0\.0,one\)/)
  assertProgramAssembles(vsmVisualizeSunsWgsl(ON), 'vsmVisualizeSuns', 'the suns')
  assertProgramAssembles(vsmVisualizeLocalsWgsl(ON), 'vsmVisualizeLocals', 'the locals')
  assertProgramAssembles(vsmVisualizePerLightWgsl(ON), 'vsmVisualizeLocals', 'the per-light')
  assert.doesNotMatch(vsmVisualizeSunsWgsl(ON), /vsmPoolPageInfo/)
})
