// The hierarchy of boxes over the sparse voxels: its layout, the bias that fits a device, and the kernels' texts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { HV_BOX_WALK_WGSL, SV_BOX_HIERARCHY_WGSL, SV_MIN_LEVEL_WGSL } from './boxHierarchyWgsl.ts'
import {
  BOX_HEADER_WORDS,
  BOX_MAX_LEVELS,
  boxHeader,
  boxLayout,
  boxLevelCount,
  boxLevelResolution,
  fitSparseVoxelBias,
} from './boxHierarchyPlan.ts'
import { SV_VOXEL_DATA_WGSL } from './voxelDataWgsl.ts'

test('a level is the volume cut in halves, held up to the cell that covers its edge', () => {
  assert.deepEqual(boxLevelResolution([5, 4, 1], 0), [5, 4, 1])
  assert.deepEqual(boxLevelResolution([5, 4, 1], 1), [3, 2, 1])
  assert.deepEqual(boxLevelResolution([5, 4, 1], 2), [2, 1, 1])
  assert.equal(boxLevelCount([5, 4, 1]), 4)
  assert.equal(boxLevelCount([1, 1, 1]), 1)
  assert.ok(boxLevelCount([1024, 1024, 1024]) <= BOX_MAX_LEVELS)
})

test('every cell has an ancestor on each level above it, inside that level', () => {
  const resolution = [7, 5, 3] as const
  const levels = boxLevelCount(resolution)
  for (let x = 0; x < 7; x++)
    for (let y = 0; y < 5; y++)
      for (let z = 0; z < 3; z++)
        for (let level = 1; level < levels; level++) {
          const side = boxLevelResolution(resolution, level)
          assert.ok(x >> level < side[0] && y >> level < side[1] && z >> level < side[2])
        }
  assert.deepEqual(boxLevelResolution(resolution, levels - 1), [1, 1, 1])
})

test('the layout puts the levels from the bias up after the header and the boxes at an offset a binding can start at', () => {
  const layout = boxLayout([8, 8, 8], 1, 100)
  assert.equal(layout.levels, 4)
  assert.deepEqual(layout.offsets, [
    0,
    BOX_HEADER_WORDS,
    BOX_HEADER_WORDS + 64,
    BOX_HEADER_WORDS + 64 + 8,
  ])
  assert.equal(layout.nodesEnd, BOX_HEADER_WORDS + 64 + 8 + 1)
  assert.equal(layout.positions % 64, 0)
  assert.ok(layout.positions >= layout.nodesEnd)
  assert.equal(layout.words, layout.positions + 600)
  const header = boxHeader([8, 8, 8], layout)
  assert.deepEqual(Array.from(header.slice(0, 5)), [4, layout.positions, 8, 8, 8])
  assert.deepEqual(Array.from(header.slice(5, 9)), layout.offsets)
})

test('the bias is raised until the voxels and the boxes fit the largest binding', () => {
  const side = [64, 64, 64] as const
  assert.equal(fitSparseVoxelBias(side, 0, 1e12), 0)
  assert.equal(fitSparseVoxelBias(side, 3, 1e12), 3)
  const fit = fitSparseVoxelBias(side, 0, 1_000_000)
  assert.ok(fit > 0)
  assert.ok(boxLayout(side, fit, (64 >> fit) ** 3).words * 4 <= 1_000_000)
  assert.equal(fitSparseVoxelBias(side, 0, 1), 6)
})

test('the kernels declare their entry points over the bindings they list, and no backtick', () => {
  const entry = (text: string) =>
    [...text.matchAll(/@compute @workgroup_size\([^)]*\)\s*fn (\w+)/g)].map((m) => m[1])
  const bindings = (text: string) =>
    [...text.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]))
  assert.deepEqual(entry(SV_MIN_LEVEL_WGSL), ['buildMinLevel'])
  assert.deepEqual(bindings(SV_MIN_LEVEL_WGSL), [0, 1, 2])
  assert.deepEqual(entry(SV_BOX_HIERARCHY_WGSL), ['buildBoxHierarchy'])
  assert.deepEqual(bindings(SV_BOX_HIERARCHY_WGSL), [0, 1, 2, 3])
  for (const text of [SV_MIN_LEVEL_WGSL, SV_BOX_HIERARCHY_WGSL, wgslModule(HV_BOX_WALK_WGSL)])
    assert.equal(text.includes('`'), false)
})

test('the build marks the nodes above a leaf and stops at the first already marked', () => {
  assert.match(SV_BOX_HIERARCHY_WGSL, /atomicStore\(&boxes\[nodeIndex\(packed\.y,cell\)\],at\+1u\)/)
  assert.match(
    SV_BOX_HIERARCHY_WGSL,
    /atomicOr\(&boxes\[nodeIndex\(level,cell\)\],0x80000000u\)!=0u\)\{break;\}/,
  )
})

test('the walk takes the nearest voxel: children farthest first on the stack, nodes past the nearest leaf dropped', () => {
  const walk = wgslModule(HV_BOX_WALK_WGSL)
  assert.match(walk, /fn hvNextVoxelSpan\(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32\)->vec2f/)
  assert.match(walk, /if\(stackT\[top\]>=bestT\)\{continue;\}/)
  assert.match(walk, /childT\[k-1u\]<span\.x/)
})

test('a voxel covers its cells to the edge of a volume whose sides are not powers of two', () => {
  assert.match(
    wgslModule(SV_VOXEL_DATA_WGSL),
    /min\(vec3f\(\(cell\+vec3u\(1u\)\)<<vec3u\(mip\)\),res\)/,
  )
})
