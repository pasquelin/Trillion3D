// The levels of the pages and the march of the transmittance: what the text of their programs holds of the reference's rules.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MIP_ARGS_WGSL, MIP_WGSL } from './voxelMipWgsl.ts'
import { voxelTraversalWgsl } from './voxelTraversalWgsl.ts'
import { voxelTransmittanceWgsl } from './voxelTransmittanceWgsl.ts'

test('a voxel of the next level keeps one unit of hair where any of the eight holds some, and the mean of the opaque marks', () => {
  assert.match(MIP_WGSL, /select\(0u,max\(hair\/8u,1u\),hair>0u\)/)
  assert.match(MIP_WGSL, /clamp\(opaque\/8\.0,select\(0\.0,1\.0,opaque>0\.0\),127\.0\)/)
  assert.match(MIP_WGSL, /caster=caster\|\|\(own>0u&&/)
})

test('the pass that ends on the level of 4 voxels reduces it to 2 and 1, and takes an empty page out of the index there', () => {
  const aggregate = MIP_WGSL.slice(MIP_WGSL.indexOf('fn hairVoxelMipAggregate'))
  assert.equal(aggregate.split('workgroupBarrier()').length, 3, 'two barriers, in the entry')
  assert.match(aggregate, /TARGET\+1u/)
  assert.match(aggregate, /TARGET\+2u/)
  assert.match(aggregate, /PATCH_EMPTY!=0u&&\(total&\d+u\)==0u/)
  assert.match(MIP_ARGS_WGSL, /mipArgs\[at\+1u\]=voxelArgs\[1\]/)
})

test('the march steps a voxel at a time and stops where the visibility is nil or the count passes the threshold', () => {
  for (const mipmap of [false, true]) {
    const code = voxelTransmittanceWgsl(mipmap, false)
    assert.match(
      code,
      /trace\.visibility==0\.0\|\|\(settings\.countThreshold!=0\.0&&trace\.hairCount>settings\.countThreshold\)/,
    )
    assert.match(code, /const SAMPLES=1u;/)
    assert.equal(
      code.includes('stepScale=min(f32(params.pageResolution)'),
      mipmap,
      'the step grows only through the levels',
    )
  }
  assert.match(voxelTransmittanceWgsl(true, true), /const SAMPLES=8u;/)
  assert.ok(voxelTraversalWgsl(true).text.includes('max(deltaWorld*stepScale'))
})

test('the transmittance packs the count times 1000 on 24 bits and the visibility on the 8 above', () => {
  assert.match(
    voxelTransmittanceWgsl(false, false),
    /min\(u32\(hairCount\*1000\.0\),0x00FFFFFFu\)\|\(min\(u32\(visibility\*255\.0\),0xFFu\)<<24u\)/,
  )
})
