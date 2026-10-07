// A grouped bin of the per-page dispatcher launches `dim`² groups a map; its maps, past one
// dimension's 65,535 groups, run along z in rows up y (`vsmDispatchPerPageBin`). The shipped walk
// (`vsmMapWalkOf`) runs over every thread of the dispatch: each map's page walk is visited once,
// a map of a single row as before the rows, and a thread past the bin's maps walks none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { builtins } from '../texture/shaderRunBuiltins.fixture.ts'
import { VSM_PER_PAGE_DISPATCH_WGSL, VSM_PER_PAGE_GROUP_XY as XY } from './markingWgsl.ts'
import { vsmDispatchPerPageBin, vsmWritePerPageBinArgs } from './markingPass.ts'

type Walk = { valid: boolean; handle: { id: number }; walkStart: number[] }

/** Bin `b`'s dispatch of `count` maps, as `[x, y, z]` groups. */
function grid(b: number, count: number) {
  let groups: number[] = []
  const pass = { dispatchWorkgroups: (...xyz: number[]) => (groups = xyz) }
  vsmDispatchPerPageBin(pass as unknown as GPUComputePassEncoder, { offset: 0, count }, b)
  return groups
}

/** The walk of every thread of bin `b`'s dispatch of `count` maps, its first `xs` along x. */
function walks(b: number, count: number, xs: number) {
  const params = new Uint32Array(4),
    idStart = 5
  vsmWritePerPageBinArgs(params, 0, { offset: idStart, count }, b)
  const [idStartWord, idCount, gridWidth, threadPerId] = params
  const { vsmMapWalkOf } = shaderRun<{ vsmMapWalkOf: (id: number[], n: number[]) => Walk }>(
    VSM_PER_PAGE_DISPATCH_WGSL,
    ['vsmMapWalkOf'],
    {
      vsmPerPage: { idStart: idStartWord, idCount, gridWidth, threadPerId },
      vsmPerPageIds: Array.from({ length: idStart + count }, (_, i) => i - idStart),
      vsmHandleFromId: (id: number) => ({ id, isSinglePage: true }),
      vsmHandleInvalid: () => ({ id: -1, isSinglePage: false }),
      VSM_MIPS: 8,
      // Every word of the walk is a u32: its division truncates, as WGSL's does.
      $b: (op: string, a: number, b: number) =>
        op === '/' ? Math.trunc(a / b) : builtins.$b(op, a, b),
    },
  )
  const n = grid(b, count),
    out: { id: number[]; walk: Walk }[] = []
  for (let z = 0; z < n[2]; z++)
    for (let y = 0; y < n[1] * XY; y++)
      for (let x = 0; x < xs; x++) out.push({ id: [x, y, z], walk: vsmMapWalkOf([x, y, z], n) })
  return { out, gridWidth }
}

test('a grouped bin past 65,535 maps runs them in rows along z, no dimension past the limit', () => {
  for (const [b, dim] of [
    [0, 8],
    [1, 4],
    [2, 1],
  ]) {
    assert.deepEqual(grid(b, 300), [dim, dim, 300], 'one row: the dispatch of before')
    assert.deepEqual(grid(b, 65_535), [dim, dim, 65_535])
    assert.deepEqual(grid(b, 65_537), [dim, dim * 2, 65_535])
  }
})

test('a single row walks map z from its thread, as before the rows', () => {
  for (const b of [0, 1, 2]) {
    const { out } = walks(b, 3, grid(b, 3)[0] * XY)
    for (const { id, walk } of out) {
      assert.ok(walk.valid)
      assert.equal(walk.handle.id, id[2])
      assert.deepEqual(walk.walkStart, [id[0], id[1]])
    }
  }
})

test("past one row, every map's walk is visited once and a padding thread walks none", () => {
  const count = 65_537,
    { out, gridWidth } = walks(2, count, 1),
    seen = new Uint8Array(count * gridWidth)
  let padding = 0
  for (const { id, walk } of out) {
    if (!walk.valid) {
      padding++
      continue
    }
    assert.equal(walk.walkStart[0], id[0])
    const at = walk.handle.id * gridWidth + walk.walkStart[1]
    assert.equal(seen[at]++, 0, `map ${walk.handle.id} row ${walk.walkStart[1]} walked twice`)
  }
  assert.ok(
    seen.every((hit) => hit === 1),
    'every map walked over its whole side',
  )
  assert.equal(padding, (2 * 65_535 - count) * gridWidth)
})
