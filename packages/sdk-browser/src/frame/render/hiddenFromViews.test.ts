import test from 'node:test'
import assert from 'node:assert/strict'
import { hiddenFromViews, worldSpaceRanks } from './hiddenFromViews.ts'
import { HIDDEN_SHADOW_ROOT, WORLD_SPACE_ROOT } from '../../visibility/shader/castingMark.ts'
import { OBJECT_ONLY_OWNER_SEE, OBJECT_OWNER_NO_SEE } from '../../geometry/rows/page/offsetRow.ts'
import { createViewHidden } from './viewHidden.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

// What a view does not draw whatever its lists say: the objects its owner does not see (`Camera.owner`,
// `Object3D.ownerNoSee`, `onlyOwnerSee`, which the offsets' reader writes in the root's row), the stand-ins of first-person objects,
// the hidden that cast.
const box = () => object.mesh(geometry.box(1, 1, 1))

/** The view bits of a node's row, as the offsets' reader writes them. */
const viewBitsOf = (node: Object3D) =>
  (node.ownerNoSee ? OBJECT_OWNER_NO_SEE : 0) | (node.onlyOwnerSee ? OBJECT_ONLY_OWNER_SEE : 0)

/** A runtime of one root a node, its rows holding the view bits the nodes' switches name. */
function runtimeOf(nodes: Object3D[], marks: (number | undefined)[] = []) {
  const selectionRoots = nodes.map((node, rank) => ({
    pages: [{ drawSource: { node } }],
    mark: marks[rank],
    hidden: marks[rank] === HIDDEN_SHADOW_ROOT,
  }))
  const viewHidden = createViewHidden()
  nodes.forEach((node, rank) => viewHidden.setViewed(rank, viewBitsOf(node) !== 0))
  // Every root is settled once, as the host's visibility pass does (`settleRoot`).
  selectionRoots.forEach((root, rank) => viewHidden.note(rank, root))
  return {
    layout: { selectionRoots, rootIndex: { revision: 0 }, viewHidden },
    run: { gate: { revisions: { scene: 1 } } },
    vis: { rootOffsets: { rowOf: (rank: number) => ({ bits: viewBitsOf(nodes[rank]!) }) } },
  } as unknown as WebgpuPagesRuntime
}

test('an object that hides from its owner is hidden from the views that own it alone', () => {
  const player = box(),
    hands = box(),
    wall = box(),
    other = box()
  player.add(hands)
  hands.ownerNoSee = true
  const rt = runtimeOf([hands, wall, other])
  assert.deepEqual(hiddenFromViews(rt, true, null), [], 'a view with no owner owns nothing')
  assert.deepEqual(hiddenFromViews(rt, true, player), [0], 'the owner’s view: hands is under it')
  assert.deepEqual(hiddenFromViews(rt, true, other), [], 'a view owned by another node')
  assert.equal(hiddenFromViews(rt, true, player), hiddenFromViews(rt, true, player), 'one list')
})

test('an object only its owner sees is hidden from every other view, those with no owner included', () => {
  const player = box(),
    sight = box(),
    wall = box()
  player.add(sight)
  sight.onlyOwnerSee = true
  const rt = runtimeOf([sight, wall])
  assert.deepEqual(hiddenFromViews(rt, true, null), [0])
  assert.deepEqual(hiddenFromViews(rt, false, null), [0])
  assert.deepEqual(hiddenFromViews(rt, true, wall), [0])
  assert.deepEqual(hiddenFromViews(rt, true, player), [], 'the owner’s view draws it')
})

test('the stand-in of a first-person object keeps the main view’s rule until a camera names an owner', () => {
  const player = box(),
    body = box(),
    other = box()
  player.add(body)
  const rt = runtimeOf([body, other], [WORLD_SPACE_ROOT, undefined])
  assert.deepEqual(hiddenFromViews(rt, true, null), [0], 'the main view, no owner')
  assert.deepEqual(hiddenFromViews(rt, false, null), [], 'another view, no owner')
  assert.deepEqual(
    hiddenFromViews(rt, false, player),
    [0],
    'a view that owns it, as ownerNoSee forced',
  )
  assert.deepEqual(hiddenFromViews(rt, true, other), [], 'a main view owned by another node')
})

test('a hidden object that casts its shadow is drawn by no view', () => {
  const ghost = box()
  const rt = runtimeOf([ghost], [HIDDEN_SHADOW_ROOT])
  for (const main of [true, false]) assert.deepEqual(hiddenFromViews(rt, main, null), [0])
})

test('the roots are read again when the views draw others: a root shown or hidden, not each scene revision', () => {
  const ghost = box()
  const rt = runtimeOf([ghost], [HIDDEN_SHADOW_ROOT])
  const root = rt.layout.selectionRoots[0] as { hidden?: boolean }
  assert.deepEqual(hiddenFromViews(rt, true, null), [0])
  root.hidden = false
  assert.deepEqual(hiddenFromViews(rt, true, null), [0], 'nothing announced it')
  rt.layout.viewHidden.note(0, root)
  assert.deepEqual(hiddenFromViews(rt, true, null), [], 'shown')
})

test('a root whose row bits change is listed, then dropped, as the offsets’ reader says so', () => {
  const player = box(),
    hands = box()
  player.add(hands)
  const rt = runtimeOf([hands])
  const { viewHidden } = rt.layout
  assert.deepEqual(hiddenFromViews(rt, true, player), [])
  hands.ownerNoSee = true
  viewHidden.setViewed(0, true)
  assert.deepEqual(hiddenFromViews(rt, true, player), [0])
  hands.ownerNoSee = false
  viewHidden.setViewed(0, false)
  assert.deepEqual(hiddenFromViews(rt, true, player), [])
})

test('the stand-ins of first-person objects are listed by rank with the lists of the views, one array until the roots change', () => {
  const [a, b, c] = [box(), box(), box()]
  const rt = runtimeOf([a, b, c], [WORLD_SPACE_ROOT, undefined, WORLD_SPACE_ROOT])
  assert.deepEqual(worldSpaceRanks(rt), [0, 2])
  assert.equal(worldSpaceRanks(rt), worldSpaceRanks(rt), 'one list')
  ;(rt.layout.selectionRoots[1] as { mark?: number }).mark = WORLD_SPACE_ROOT
  rt.layout.viewHidden.note(1, rt.layout.selectionRoots[1]!)
  assert.deepEqual(worldSpaceRanks(rt), [0, 1, 2], 'marked, announced')
})

test('an owner’s list follows a node re-parented out of it and back, though no set of the roots changed: the scene’s revision drops it', () => {
  const player = box(),
    hands = box(),
    other = box()
  player.add(hands)
  hands.ownerNoSee = true
  const rt = runtimeOf([hands])
  const scene = rt.run.gate.revisions
  assert.deepEqual(hiddenFromViews(rt, true, player), [0], 'under its owner')
  assert.equal(
    hiddenFromViews(rt, true, player),
    hiddenFromViews(rt, true, player),
    'one list while the scene stands',
  )
  other.add(hands)
  scene.scene++
  assert.deepEqual(
    hiddenFromViews(rt, true, player),
    [],
    'no longer under the owner’s view: drawn by it',
  )
  player.add(hands)
  scene.scene++
  assert.deepEqual(hiddenFromViews(rt, true, player), [0], 'back under it')
})

test('the roots past the count the session holds are forgotten', () => {
  const [a, b] = [box(), box()]
  const rt = runtimeOf([a, b], [WORLD_SPACE_ROOT, WORLD_SPACE_ROOT])
  assert.deepEqual(worldSpaceRanks(rt), [0, 1])
  rt.layout.selectionRoots.length = 1
  assert.deepEqual(worldSpaceRanks(rt), [0], 'one root left: the other’s facts go')
})
