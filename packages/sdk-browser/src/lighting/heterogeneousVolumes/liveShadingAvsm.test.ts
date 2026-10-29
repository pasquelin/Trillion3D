// The adaptive volumetric shadow map of the live shading: its build kernel, its read and the layout of its blocks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { HETEROGENEOUS_VOLUME_RULES } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import { HV_AVSM_BUILD_WGSL } from './liveShadingAvsmWgsl.ts'
import { AVSM_READ_WGSL } from './volumetricShadow/avsmReadWgsl.ts'
import {
  AVSM_BLOCK_ALIGN,
  avsmBlockLayout,
  avsmListBytes,
  fitAvsmResolution,
} from './volumetricShadow/avsmBlockPlan.ts'

test('the options keep the reference defaults', () => {
  assert.equal(HETEROGENEOUS_VOLUME_RULES.heterogeneousVolumesShadowsType.default, 1)
  assert.equal(HETEROGENEOUS_VOLUME_RULES.heterogeneousVolumesHardwareRayTracing.default, false)
})

test('the build keeps the reference steps: first sample, error test, stitch, last sample at the last extinction', () => {
  const text = wgslModule(HV_AVSM_BUILD_WGSL)
  assert.match(text, /fn hvAvsmShadowMain\(/)
  assert.match(text, /avsmAddSample\(avsmSample\(worldT,grey\),pixel,&prevElement,&element\)/)
  assert.match(
    text,
    /absoluteError>avsmParams\.absoluteError&&relativeError>avsmParams\.relativeError/,
  )
  assert.match(text, /avsmSample\(lastWorldT,/)
  assert.match(text, /avsmListSetNext\(last,AVSM_NULL_PTR\)/)
  assert.equal(text.includes('`'), false)
})

test('the read searches the second level and never fits an infinite rate', () => {
  const text = wgslModule(AVSM_READ_WGSL)
  assert.match(text, /while\(high-low>1\)/)
  assert.match(text, /max\(b\.tau\*avsmSafeRcp\(a\.tau\),1\.0e-30\)/)
  assert.equal(text.includes('`'), false)
})

test('a block starts and ends at multiples of 64 words, the atlas after the indirection entries', () => {
  const layout = avsmBlockLayout(10, 6, 8)
  assert.equal(layout.texels, 16 * 16 * 6)
  assert.equal(layout.indirectionBytes, layout.texels * 16)
  assert.equal(layout.atlasStart % AVSM_BLOCK_ALIGN, 0)
  assert.ok(layout.atlasStart >= 64 + layout.texels * 4)
  assert.equal(layout.words, layout.atlasStart + layout.texels * 12)
})

test('the resolution is halved while the lists or the pack would not fit', () => {
  assert.equal(fitAvsmResolution(512, [1], 8, 1e12, 3), 512)
  const fit = fitAvsmResolution(512, [6, 6], 8, 128 * 1024 * 1024, 4)
  assert.ok(fit < 512 && fit >= 16)
  assert.ok(avsmListBytes(fit, 6, 8) <= 128 * 1024 * 1024)
  assert.equal(fitAvsmResolution(512, [6], 8, 1, 3), 16)
})

test('a program of each variant declares its extra buffer, and the plain one a march that visits no voxel', async () => {
  const { HETEROGENEOUS_VOLUME_SHADERS: shaders } =
    await import('../../gpu/core/engineShaders.heterogeneousVolumes.fixture.ts')
  assert.match(
    shaders.HETEROGENEOUS_VOLUME_BOXES,
    /@binding\(57\) var<storage,read> hvBoxes:array<u32>/,
  )
  assert.match(
    shaders.HETEROGENEOUS_VOLUME_BOXES,
    /fn hvNextVoxelSpan\(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32\)->vec2f\{\n/,
  )
  assert.match(
    shaders.HETEROGENEOUS_VOLUME_AVSM_BUILD,
    /@binding\(58\) var<storage,read_write> avsmList/,
  )
  assert.match(shaders.HETEROGENEOUS_VOLUME_AVSM_BUILD, /fn hvAvsmShadowMain\(/)
  assert.match(shaders.HETEROGENEOUS_VOLUME, /return vec2f\(0\.0,-1\.0\);/)
  assert.equal(shaders.HETEROGENEOUS_VOLUME.includes('hvBoxes'), false)
  assert.equal(shaders.HETEROGENEOUS_VOLUME.includes('hvAvsmShadowMain'), false)
})
