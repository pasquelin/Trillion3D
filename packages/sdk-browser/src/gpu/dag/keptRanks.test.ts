// Each kept list's ranks live in a table its readout's list bounds, never the pages
// (`keptRanks.ts`): the kernel's own functions run in Node (`wgslScope`) against the host's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader/shader.ts'
import { wgslScope } from '../../page/cut/wgslPredicate.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { KEPT_RANK_HEAD, keptRankCapHeld, keptRankRow } from './keptRanks.ts'
import { deviceListCap } from './deviceListCap.ts'
import { createDagList } from './listCap.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

/** Slots of the table the host makes for a list of `listCap` ranks: three words each. */
const keptRankSlots = (listCap: number) => (keptRankRow(0, listCap).size / 4 - KEPT_RANK_HEAD) / 3

/** The kernel's table functions for a list of `listCap` ranks. */
function kernel(listCap: number) {
  const scope = wgslScope(DAG_SELECTION_SHADER, {
    ...wgslConstants(DAG_SELECTION_SHADER),
    views: [{ listCap }],
    countLeadingZeros: Math.clz32,
    max: Math.max,
  })
  const fn = (name: string) => scope.fn(name) as (...args: number[]) => number
  return { keptSlots: fn('keptSlots') }
}

test('a kept list’s table follows the list, loaded one half at most, whatever the pages', () => {
  for (const cap of [1, 3, 64, 1000, 262144]) {
    assert.equal(kernel(cap).keptSlots(), keptRankSlots(cap), `the kernel's slots for ${cap}`)
    assert.ok(cap / keptRankSlots(cap) <= 1 / 2, `a full list of ${cap} loads it one half at most`)
    assert.ok(keptRankSlots(cap) < 4 * cap, 'never four times the list')
  }
  // The tables are the readout's: made with its list, sized by its cap alone.
  installGpuGlobals()
  const sizes: number[] = []
  const own = (d: GPUBufferDescriptor) => (sizes.push(d.size), {}) as GPUBuffer
  const list = createDagList(own, 1000)
  assert.equal(list.ranks.length, 2)
  assert.deepEqual(
    sizes.slice(-2),
    [0, 1].map((l) => keptRankRow(l, 1000).size),
  )
  // A device lists no more than its binding holds the table of.
  const limits = { maxStorageBufferBindingSize: keptRankRow(0, 4096).size }
  assert.ok(
    deviceListCap(limits) <= 4096 && keptRankCapHeld(limits.maxStorageBufferBindingSize) === 4096,
  )
})
