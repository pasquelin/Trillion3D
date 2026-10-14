// The ray query's shipped WGSL run as JavaScript (`shaderRun`): a ray's filter admits the placements
// its sorted list names, or every other one, as its include bit asks; the deformation index answers
// each deformed page with its results' word and its row's base, and zeros for any other; the trace
// reads the cut's nodes, frame words, worlds and placement tree in the culling's record tables, at
// the culling's bindings, beside three storage buffers of its own whatever the world's size.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { RAY_QUERY_WGSL, rayQueryWgsl } from './rayQueryWgsl.ts'
import { unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { dagBindingOf } from '../../gpu/dag/shader/bindings.fixture.ts'
import { FILTER_INCLUDE } from './rayRecord.ts'
import { DEFORM_SLOT_WORDS } from './deformIndexWgsl.ts'

const params = { filterWord: 10, hashWord: 32, hashMask: 15 }
const query = new Array<number>(128).fill(0)
const run = shaderRun<{
  rqAdmits(w: number, first: number, word: number): boolean
  deformedOf(page: number): number[]
}>(RAY_QUERY_WGSL, ['rqAdmits', 'deformedOf', 'deformSlot'], {
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
  // The index as the indexing kernel leaves it: from the page's slot on, the first free slot.
  const slots = params.hashMask + 1,
    deformed = new Map([
      [7, [101, 5]],
      [23, [202, 0]],
      [39, [303, 9]],
      [1, [404, 2]],
    ])
  query.fill(0, params.hashWord, params.hashWord + DEFORM_SLOT_WORDS * slots)
  for (const [page, words] of deformed) {
    let slot = ((page * 2654435761) % 2 ** 32) & params.hashMask
    while (query[params.hashWord + DEFORM_SLOT_WORDS * slot]) slot = (slot + 1) & params.hashMask
    const at = params.hashWord + DEFORM_SLOT_WORDS * slot
    query.splice(at, 3, page + 1, ...words)
  }
  for (const [page, words] of deformed) assert.deepEqual([...run.deformedOf(page)], words)
  assert.deepEqual([...run.deformedOf(8)], [0, 0], 'a page nothing deformed')
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

test("the shipped trace and the audit's counting one declare every function they call", () => {
  // The counter hooks are declarations each program lists (`rayCountWgsl.ts`): empty in the
  // shipped kernel, counting in the audit's — never a call a device cannot resolve.
  for (const text of [RAY_QUERY_WGSL, rayQueryWgsl(true)]) {
    assert.deepEqual(unresolvedNames(text), [])
    for (const hook of ['rqCount', 'rqCountRoot', 'rqFlushCounts'])
      assert.match(text, new RegExp(`fn ${hook}\\(`), hook)
  }
  assert.ok(!/rqCounts/.test(RAY_QUERY_WGSL), 'the shipped kernel binds no counters')
})
