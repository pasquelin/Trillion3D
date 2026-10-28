// The translucency lighting volume's marked cells (`translucencyVolumeMarkVoxels`): the setting, the frame's words, the layouts of the
// marks and the text of the passes that make and read them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import { INJECT_BINDING, INJECT_PROGRAM } from './injectWgsl.ts'
import { FILTER_BINDING, FILTER_PROGRAM } from './filterWgsl.ts'
import {
  ARGS_PROGRAM,
  CLEAR_PROGRAM,
  DILATE_PROGRAM,
  GATHER_PROGRAM,
  translucencyVolumeMarkWgsl,
} from './markWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  MARKED_WORKGROUP,
  MOST_GROUPS_PER_AXIS,
  TRANSLUCENCY_FRAME,
  WRAPPED_GROUP_STRIDE,
  markExtent,
  markedCells,
  markedListBytes,
  volumeExtent,
} from './layout.ts'

test('the cells are not marked unless the setting asks it', () => {
  assert.equal(resolveSettings(TRANSLUCENCY_VOLUME_RULES, {}).translucencyVolumeMarkVoxels, false)
  assert.equal(
    resolveSettings(TRANSLUCENCY_VOLUME_RULES, { translucencyVolumeMarkVoxels: true })
      .translucencyVolumeMarkVoxels,
    true,
  )
})

test('the frame ends with the marks words, which no earlier field moves', () => {
  const at = TRANSLUCENCY_FRAME.at
  assert.equal(at.marks, at.eye + 4)
  assert.equal(TRANSLUCENCY_FRAME.words, at.marks + 4)
})

test('the marks are one word a cell of either cascade, stacked as the volume stacks its slabs', () => {
  assert.deepEqual(markExtent(32), [32, 32, 64])
  assert.deepEqual(volumeExtent(32), [32, 32, 128], 'two slabs a cascade')
  assert.equal(markedCells(32), 2 * 32 ** 3)
  assert.equal(markedListBytes(32), 4 * markedCells(32))
  assert.equal(MARKED_WORKGROUP, 64)
})

test('the marked injection reads the list and the count the arguments kernel counts the groups of', () => {
  assert.ok(INJECT_PROGRAM.includes('fn injectMarkedMain('))
  assert.ok(
    INJECT_PROGRAM.includes(`@binding(${INJECT_BINDING.marked}) var<storage,read> tvMarked`),
  )
  assert.ok(INJECT_PROGRAM.includes('fn injectMain('), 'the unmarked injection stays')
  assert.ok(ARGS_PROGRAM.includes(`/${MARKED_WORKGROUP}u`))
  assert.ok(ARGS_PROGRAM.includes(`>${MOST_GROUPS_PER_AXIS}u`))
  assert.ok(ARGS_PROGRAM.includes(`${WRAPPED_GROUP_STRIDE}u`))
  assert.ok(
    INJECT_PROGRAM.includes(`${WRAPPED_GROUP_STRIDE}u`),
    'the injection unwraps what the kernel wraps',
  )
})

test('both filters empty a cell no mark reaches, and the temporal one reads the marks of the image before', () => {
  assert.equal(FILTER_PROGRAM.split('tv.marks.x!=0u&&!tvMarkedIn(tvMarks,').length - 1, 2)
  assert.ok(FILTER_PROGRAM.includes('tv.marks.y!=0u&&!tvMarkedIn(tvHistoryMarks,'))
  assert.ok(
    FILTER_PROGRAM.includes(`@binding(${FILTER_BINDING.marks}) var tvMarks:texture_3d<u32>`),
  )
})

test('the marks’ passes each name their entry point', () => {
  for (const [program, entry] of [
    [CLEAR_PROGRAM, 'clearMain'],
    [DILATE_PROGRAM, 'dilateMain'],
    [GATHER_PROGRAM, 'gatherMain'],
    [ARGS_PROGRAM, 'argsMain'],
  ] as const)
    assert.ok(program.includes(`fn ${entry}(`), entry)
})

test('the dilation marks the cell and the eight corners of the cube round it, 255 each, the gathering one add a cell', () => {
  assert.ok(DILATE_PROGRAM.includes('255u'))
  assert.ok(DILATE_PROGRAM.includes('for(var i=0u;i<8u;i++)'))
  assert.ok(GATHER_PROGRAM.includes('atomicAdd(&tvCount[0],1u)'))
})

test('a surface marks the eight cells of a trilinear fetch in each cascade it reads', () => {
  const text = wgslModule(translucencyVolumeMarkWgsl(1, 2, 3))
  assert.ok(text.includes('@group(1) @binding(2) var<uniform> tv:TranslucencyFrame'))
  assert.ok(text.includes('@group(1) @binding(3) var tvMarks:texture_storage_3d<r32uint,write>'))
  assert.ok(text.includes('floor(uvw*f32(tv.mode.x)-vec3f(0.5))'))
  assert.ok(text.includes('if(share>0.0){markVolumeTrilinear(0u,inner);}'))
  assert.ok(text.includes('if(share<1.0){markVolumeTrilinear(1u,outer);}'))
})
