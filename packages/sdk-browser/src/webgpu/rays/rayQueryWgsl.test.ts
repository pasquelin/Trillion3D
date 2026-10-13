// The ray query's shipped WGSL run as JavaScript (`shaderRun`): a ray's filter admits the placements
// its sorted list names, or every other one, as its include bit asks; the deformation index answers
// each deformed page with its results' word and its row's base, and zeros for any other; the trace
// binds eight storage buffers at most, its nodes in three parts, and reads the worlds and the
// placement tree in the culling's two record tables.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { rayQueryWgsl } from './rayQueryWgsl.ts'
import { FILTER_INCLUDE } from './rayRecord.ts'
import { DEFORM_SLOT_WORDS } from './deformIndexWgsl.ts'

const params = { filterWord: 10, hashWord: 32, hashMask: 15 }
const query = new Array<number>(128).fill(0)
const run = shaderRun<{
  rqAdmits(w: number, first: number, word: number): boolean
  deformedOf(page: number): number[]
}>(rayQueryWgsl({ nodes: { per: Infinity, parts: 1 } }), ['rqAdmits', 'deformedOf'], {
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

test('the trace binds eight storage buffers at most, its nodes in three parts, whatever the ranges', () => {
  const split = rayQueryWgsl({ nodes: { per: 4096, parts: 3 } }),
    whole = rayQueryWgsl({ nodes: { per: Infinity, parts: 1 } })
  assert.equal(split.match(/var<storage/g)?.length, 7)
  assert.equal(whole.match(/var<storage/g)?.length, 5)
  // The worlds and the tree are the culling's record tables, sampled where they lie: no member
  // order or world is copied into a buffer of the query's.
  for (const text of [split, whole]) {
    assert.equal(text.match(/texture_2d_array<u32>/g)?.length, 2)
    assert.ok(!/memberWord/.test(text), 'no copied member order')
  }
})
