// The text of the voxel programs: the order of the reference's allocation, and what each binds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VOXEL_INJECT_WGSL, VOXEL_RASTER_WGSL } from './voxelRasterWgsl.ts'
import {
  ADD_NODE_WGSL,
  ALLOCATE_PAGE_INDEX_WGSL,
  ALLOCATE_PAGES_WGSL,
  FEEDBACK_WGSL,
  MARK_VALID_WGSL,
} from './voxelWgsl.ts'

test('the page index of the groups follows their order, and a group the index has no room for gets none', () => {
  const code = ALLOCATE_PAGE_INDEX_WGSL
  assert.match(code, /fits=fits&&\(offset\+count<=params\.totalPageIndexCount\)/)
  assert.match(code, /select\(INVALID_PAGE,offset,fits\)/)
  assert.ok(code.indexOf('workgroupBarrier') < code.indexOf('for(var group=0u'))
})

test('a page is marked by the instances that touch it and allocated in the order of its coordinates', () => {
  assert.match(MARK_VALID_WGSL, /atomicOr\(&pageIndex\[/)
  assert.match(ALLOCATE_PAGES_WGSL, /atomicAdd\(&counter\[0\],taken\)/)
  assert.match(ALLOCATE_PAGES_WGSL, /atomicAdd\(&counter\[1u\+owner\],taken\)/)
  assert.match(ALLOCATE_PAGES_WGSL, /select\(INVALID_PAGE,page,room\)/)
})

test('a group node packs its resolution on 8 bits an axis, and its offset and voxel width on 21 and 11 bits', () => {
  assert.match(
    ADD_NODE_WGSL,
    /\(located\.x&0xFFu\)\|\(\(located\.y&0xFFu\)<<8u\)\|\(\(located\.z&0xFFu\)<<16u\)/,
  )
  assert.match(ADD_NODE_WGSL, /\(located\.w&0x1FFFFFu\)\|\(packVoxelSize\(size\)<<21u\)/)
})

test('the size feedback grows the voxels by the cube root of the pages asked and shrinks them toward the least', () => {
  assert.match(
    FEEDBACK_WGSL,
    /pow\(max\(asked\/\(held\*params\.correctionThreshold\),0\.0\),1\.0\/3\.0\)/,
  )
  assert.match(FEEDBACK_WGSL, /mix\(current,current\*ratio,params\.correctionSpeed\)/)
})

test('a segment steps by a voxel over one and a half, and its end that ends a strand is skipped', () => {
  assert.match(VOXEL_RASTER_WGSL, /const STEP_SCALE=1\.5;/)
  assert.match(VOXEL_RASTER_WGSL, /\(points\[first\]\.y>>30u\)==KIND_END/)
  assert.match(VOXEL_RASTER_WGSL, /atomicAdd\(&voxels\[word\]/)
})

test('the opaque surface marks the voxels behind it by no more than the mark count', () => {
  assert.match(VOXEL_INJECT_WGSL, /abs\(closest-voxelDepth\)<f32\(inject\.y\)\*node\.size/)
  assert.match(VOXEL_INJECT_WGSL, /atomicOr\(&voxels\[voxelAt\(page,offset\)\]/)
})
