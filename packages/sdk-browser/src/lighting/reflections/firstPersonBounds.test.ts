// The sphere that holds the first-person stand-ins (`firstPersonBounds.ts`): the union of the world boxes of the placed, shown roots
// marked as stand-ins, read again when the roots, their index or the roots shown, hidden or marked change.
import test from 'node:test'
import assert from 'node:assert/strict'
import { WORLD_SPACE_ROOT } from '../../visibility/shader/castingMark.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createViewHidden } from '../../frame/render/viewHidden.ts'
import { firstPersonBoundsOf } from './firstPersonBounds.ts'

type Root = {
  pages: []
  mark?: number
  worldBox: Float64Array
  parked?: boolean
  hidden?: boolean
}
const box = (...bounds: number[]) => new Float64Array(bounds)
const standIn = (...bounds: number[]): Root => ({
  pages: [],
  mark: WORLD_SPACE_ROOT,
  worldBox: box(...bounds),
})

/** A runtime that holds only what the reader looks at: the roots, their index and the roots the views may not draw. */
function runtime(roots: Root[]) {
  const viewHidden = createViewHidden()
  // Every root is settled once, as the host's visibility pass does (`settleRoot`).
  roots.forEach((root, rank) => viewHidden.note(rank, root))
  const layout = { selectionRoots: roots, rootIndex: { revision: 0 }, viewHidden }
  return { layout, run: { gate: { revisions: { scene: 1 } } } }
}
const read = (rt: ReturnType<typeof runtime>) => [
  ...firstPersonBoundsOf(rt as unknown as WebgpuPagesRuntime, new Float64Array(4)),
]
const near = (got: number[], want: number[]) =>
  got.forEach((x, k) => assert.ok(Math.abs(x - want[k]!) < 1e-9, `${got} is not ${want}`))

test('a scene with no stand-in has no sphere; one stand-in is the sphere about its box', () => {
  assert.deepEqual(read(runtime([])), [0, 0, 0, 0])
  assert.deepEqual(
    read(runtime([{ pages: [], worldBox: box(0, 0, 0, 9, 9, 9) }])),
    [0, 0, 0, 0],
    'not marked',
  )
  near(read(runtime([standIn(0, 0, 0, 2, 2, 2)])), [1, 1, 1, Math.sqrt(3)])
})

test('two stand-ins are held by the box of both, the sphere about it the box’s own or, if less, the reach of the two spheres', () => {
  // Boxes 2 m a side, 4 m apart along x: the union is 6 × 2 × 2, its centre (3, 1, 1), the half diagonal √11; the two spheres of radius √3
  // about the boxes' centres reach 2 + √3 from it, more.
  near(read(runtime([standIn(0, 0, 0, 2, 2, 2), standIn(4, 0, 0, 6, 2, 2)])), [
    3,
    1,
    1,
    Math.sqrt(11),
  ])
})

test('a stand-in that is parked or hidden, or no stand-in, is left out; the sphere follows the roots shown and the boxes, each image', () => {
  const kept = standIn(0, 0, 0, 2, 2, 2)
  const rt = runtime([kept, { ...standIn(100, 0, 0, 102, 2, 2), parked: true }])
  near(read(rt), [1, 1, 1, Math.sqrt(3)])
  const hidden = { ...standIn(100, 0, 0, 102, 2, 2), hidden: true }
  rt.layout.selectionRoots = [kept, hidden]
  near(read(rt), [1, 1, 1, Math.sqrt(3)])
  // The same roots, a box moved: read again at once.
  kept.worldBox.set([10, 0, 0, 12, 2, 2])
  near(read(rt), [11, 1, 1, Math.sqrt(3)])
  // A stand-in shown again.
  hidden.hidden = false
  near(read(rt), [56, 1, 1, Math.sqrt(46 * 46 + 1 + 1)])
})
