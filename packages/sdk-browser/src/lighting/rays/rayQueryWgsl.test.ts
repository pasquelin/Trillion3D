// The ray query's shipped WGSL run as JavaScript (`shaderRun`): a ray's filter admits the placements
// its sorted list names, or every other one, as its include bit asks; the deformation index answers
// each deformed page with its results' word and its cluster's base, and zeros for any other, and is
// made of the records the frame's decode wrote alone; the trace
// reads the cut's nodes, frame words, worlds and placement tree in the culling's record tables, at
// the culling's bindings, beside three storage buffers of its own whatever the world's size.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { RAY_QUERY_WGSL } from './rayQueryWgsl.ts'
import { dagBindingOf } from '../../geometry/dag/shader/bindings.fixture.ts'
import { FILTER_INCLUDE } from './rayRecord.ts'
import { DEFORM_INDEX_SHADER, DEFORM_SLOT_WORDS } from './deformIndexWgsl.ts'
import { VIS_HW, VIS_SW } from '../../geometry/dag/visible/layout.fixture.ts'

const params = { filterWord: 10, hashWord: 32, hashMask: 15 }
const query = new Array<number>(128).fill(0)
const run = shaderRun<{
  rqAdmits(w: number, first: number, word: number): boolean
  deformedOf(page: number): number[]
  deformSlot(page: number): number
}>(RAY_QUERY_WGSL, ['rqAdmits', 'deformedOf', 'deformSlot', 'mixWord'], {
  params,
  query,
})

test('a filter admits its listed placements, or all others, as its include bit asks', () => {
  const listed = [2, 5, 9, 11]
  query.splice(params.filterWord + 3, listed.length, ...listed)
  for (let w = 0; w < 14; w++) {
    const named = listed.includes(w)
    assert.equal(run.rqAdmits(w, 3, (listed.length | FILTER_INCLUDE) >>> 0), named, `${w} met`)
    assert.equal(run.rqAdmits(w, 3, listed.length), !named, `${w} passed by`)
  }
  assert.equal(run.rqAdmits(4, 3, 0), true, 'an empty list passes nothing by')
  assert.equal(run.rqAdmits(4, 3, FILTER_INCLUDE), false, 'and meets nothing when it includes')
})

test('the deformation index answers each deformed page, and zeros for any other', () => {
  // The index as the indexing kernel leaves it: from the page's slot (`deformSlot`, the word hash
  // both kernels call) on, the first free slot.
  const slots = params.hashMask + 1,
    deformed = new Map([
      [7, [101, 5]],
      [23, [202, 0]],
      [39, [303, 9]],
      [1, [404, 2]],
    ])
  query.fill(0, params.hashWord, params.hashWord + DEFORM_SLOT_WORDS * slots)
  for (const [page, words] of deformed) {
    let slot = run.deformSlot(page)
    while (query[params.hashWord + DEFORM_SLOT_WORDS * slot]) slot = (slot + 1) & params.hashMask
    const at = params.hashWord + DEFORM_SLOT_WORDS * slot
    query.splice(at, 3, page + 1, ...words)
  }
  for (const [page, words] of deformed) assert.deepEqual([...run.deformedOf(page)], words)
  assert.deepEqual([...run.deformedOf(8)], [0, 0], 'a page nothing deformed')
})

test("the deformation index reads the records the decode wrote: the software ones from the table's bottom, the hardware ones from its top", () => {
  // Room for ten records, three software and two hardware ones: 0 to 2 and 8 to 9.
  const visible = new Array<number>(16).fill(0)
  const written = (counts: [number, number], rows = 10) => {
    visible[VIS_SW] = counts[0]
    visible[VIS_HW] = counts[1]
    const { clusterWritten } = shaderRun<{ clusterWritten(i: number): boolean }>(
      DEFORM_INDEX_SHADER,
      ['clusterWritten'],
      { params: { rows }, visible },
    )
    return Array.from({ length: rows }, (_, i) => clusterWritten(i))
  }
  const only = (...at: number[]) => Array.from({ length: 10 }, (_, i) => at.includes(i))
  assert.deepEqual(written([3, 2]), only(0, 1, 2, 8, 9))
  assert.deepEqual(written([0, 0]), only(), 'an empty list holds none of the table')
  // Counted past the room too: the software ones take what there is, the hardware ones the rest.
  assert.deepEqual(written([99, 4]), only(0, 1, 2, 3, 4, 5, 6, 7, 8, 9))
  assert.deepEqual(written([6, 99]), only(0, 1, 2, 3, 4, 5, 6, 7, 8, 9))
})

test("the trace reads the cut's record tables at the culling's bindings, whatever the world", () => {
  // One text whatever the world's size: no node part, no range of frame words.
  assert.equal(RAY_QUERY_WGSL.match(/var<storage/g)?.length, 3)
  const tables = [
    ...RAY_QUERY_WGSL.matchAll(/@group\(0\) @binding\((\d+)\) var (\w+):texture_2d_array<u32>/g),
  ]
  const bound = Object.fromEntries(tables.map(([, binding, name]) => [name, Number(binding)]))
  const culling = dagBindingOf()
  assert.deepEqual(bound, {
    nodes: culling.nodes,
    worlds: culling.worlds,
    frames: culling.frames,
    tree: culling.tree,
  })
  assert.ok(!/memberWord/.test(RAY_QUERY_WGSL), 'no copied member order')
})
