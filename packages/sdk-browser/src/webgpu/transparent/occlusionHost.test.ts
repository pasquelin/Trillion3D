// A table of the same age sends again only the transparent entries whose pages a rewrite
// bounded elsewhere (`occlusionMoved`); a new age sends every entry and the never-culled bits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshTransparentCorners } from './occlusionHost.ts'
import { CORNER_VALUES } from '../../gpu/partition/contract.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

function runtime() {
  const sent: [number, number][] = [],
    unculled: number[] = []
  const recs = [0, 1, 2, 3].map((k) => ({ min: [k, 0, 0], max: [k + 1, 1, 1], material: {} }))
  const blendState = {
    table: { capacity: 4, pageOfEntry: Int32Array.of(0, 1, 2, 3) },
    occlusion: {
      unculledBits: new Uint32Array(1),
      uploadCorners: (_: Float32Array, from: number, to: number) => void sent.push([from, to]),
      uploadUnculled: () => void unculled.push(1),
    },
    occlusionCorners: new Float32Array(4 * CORNER_VALUES),
    occlusionEpoch: -1,
    occlusionMoved: { from: Infinity, to: -1 },
  }
  const layout = {
    rows: { tableEpoch: 3 },
    recordOf: (page: number) => recs[page],
    selectionRoots: [{ world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } }],
    placement: { rootOfPacked: Int32Array.of(0, 0, 0, 0) },
  }
  const rt = { blendState, layout } as unknown as WebgpuPagesRuntime
  return { rt, blendState, recs, sent, unculled }
}

test('a moved entry alone is sent again while the table keeps its age', () => {
  const { rt, blendState, recs, sent, unculled } = runtime()
  refreshTransparentCorners(rt)
  assert.deepEqual(sent, [[0, 3]], 'a new age: every entry')
  assert.equal(unculled.length, 1)
  refreshTransparentCorners(rt)
  assert.equal(sent.length, 1, 'nothing moved, nothing sent')
  const before = blendState.occlusionCorners.slice()
  Object.assign(recs[2], { moved: { min: [2, 0, 5], max: [3, 1, 6] } })
  Object.assign(blendState.occlusionMoved, { from: 2, to: 2 })
  refreshTransparentCorners(rt)
  assert.deepEqual(sent[1], [2, 2], 'its entry alone')
  assert.equal(unculled.length, 1, 'the never-culled bits are kept')
  assert.deepEqual(blendState.occlusionMoved, { from: Infinity, to: -1 })
  const at = 2 * CORNER_VALUES
  assert.notDeepEqual(
    blendState.occlusionCorners.slice(at, at + CORNER_VALUES),
    before.slice(at, at + CORNER_VALUES),
  )
  assert.deepEqual(blendState.occlusionCorners.slice(0, at), before.slice(0, at), 'the others kept')
})
