// The row cache keeps nothing per packed page (`pageState.ts`): its rows, its flags and its claims
// follow the rows and the instances that carry something, the pool slot follows each address — read
// by every instance of it —, so a scene that repeats its pages on more placements holds no more.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuRowState } from './state.ts'
import { createPackedInstances } from './instances.ts'
import { createPackedPages } from '../pages/prepare/catalogue.ts'
import { postPackedBases } from '../../page/selection/placements.ts'
import { pageAddress } from './pageSlots.ts'
import type { PageRec } from '../../page/selection/selection.ts'

/** `count` placements of one primitive of sixty-four pages, its packed pages and their row table of
 *  `rows` rows. */
function table(count: number, rows: number) {
  const pages = Array.from({ length: 64 }, (_, i) => ({ url: `p${i}` }) as PageRec)
  const roots = Array.from({ length: count }, () => ({ pages }))
  const placement = postPackedBases(roots),
    packed = createPackedPages(roots, placement)
  return {
    pages,
    packed,
    state: createWebgpuRowState(packed, rows, 0, createPackedInstances(roots, placement)),
  }
}

/** Bytes of every typed array the state holds. */
const arrayBytes = (state: object) =>
  Object.values(state).reduce(
    (sum: number, value) => sum + (ArrayBuffer.isView(value) ? value.byteLength : 0),
    0,
  )

test('the row table holds the same bytes from a hundred placements to ten thousand', () => {
  const small = table(100, 256),
    large = table(10_000, 256)
  assert.equal(large.packed.length, 640_000)
  assert.equal(arrayBytes(large.state), arrayBytes(small.state), 'nothing per page')
  // A row, a flag and a slot held: the maps hold those alone.
  for (const { state } of [small, large]) {
    state.setRowOf(5_000, 3)
    state.setResidentFlag(5_000, 1)
  }
  assert.equal(large.state.pageStateBytes, small.state.pageStateBytes)
})

test('one pool slot an address, which every instance of it reads', () => {
  const { pages, packed, state } = table(1000, 16)
  state.setAddressOffset(pageAddress(pages[7]), 4096)
  for (const placement of [0, 1, 999]) assert.equal(state.offsetOf(placement * 64 + 7), 4096)
  assert.equal(state.offsetOf(8), -1, 'another address holds none')
  assert.equal(state.offsetOf(packed.length), -1, 'past the catalogue: none')
  state.setAddressOffset(pageAddress(pages[7]), -1)
  assert.equal(state.offsetOf(64 + 7), -1, 'given back: every instance with it')
})

test('the blended instances are walked alone, never every packed page', () => {
  const pages = Array.from(
    { length: 64 },
    (_, i) => ({ url: `p${i}`, transparent: i === 9 }) as PageRec,
  )
  const roots = Array.from({ length: 1000 }, () => ({ pages }))
  const placement = postPackedBases(roots)
  const visited: number[] = []
  createPackedInstances(roots, placement).eachBlended((page) => visited.push(page))
  assert.equal(visited.length, roots.length, 'one a placement, the blended page alone')
  assert.ok(visited.every((page) => page % 64 === 9))
})
