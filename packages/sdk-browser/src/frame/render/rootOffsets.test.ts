import test from 'node:test'
import assert from 'node:assert/strict'
import { createRootOffsets } from './rootOffsets.ts'
import {
  PLACEMENT_CHANNELS_SHIFT,
  PLACEMENT_HOLDOUT,
  PLACEMENT_OBJECT_BITS,
} from '../../geometry/dag/info/placementInfoLayout.ts'
import {
  OBJECT_ONLY_OWNER_SEE,
  OBJECT_OWNER_NO_SEE,
  OBJECT_VIEW_BITS,
  objectBits,
  objectOffsetRow,
  switchesOfObject,
} from '../../geometry/rows/page/offsetRow.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'

const row = (bits: number, cache: 'auto' | 'always' = 'auto') => ({
  ...objectOffsetRow(undefined, [0, 0, 0]),
  cache,
  bits,
})

test('a row’s bits are the object’s switches in the placement’s own bits, the views’ two in none', () => {
  const node = object.mesh(geometry.box(1, 1, 1))
  assert.equal(objectBits(switchesOfObject(node)), 0, 'the defaults are none')
  node.holdout = true
  node.ownerNoSee = true
  node.lightingChannels = { channel0: false, channel1: true, channel2: false }
  const placement = PLACEMENT_HOLDOUT | (3 << PLACEMENT_CHANNELS_SHIFT)
  const bits = objectBits(switchesOfObject(node))
  assert.equal(bits & PLACEMENT_OBJECT_BITS, placement)
  assert.equal(bits & OBJECT_VIEW_BITS, OBJECT_OWNER_NO_SEE)
  node.onlyOwnerSee = true
  const both = objectBits(switchesOfObject(node))
  assert.equal(both & PLACEMENT_OBJECT_BITS, placement)
  assert.equal(both & OBJECT_VIEW_BITS, OBJECT_OWNER_NO_SEE | OBJECT_ONLY_OWNER_SEE)
})

test('a held row says what changed: nothing, or any word of the row', () => {
  const held = createRootOffsets()
  assert.equal(held.hold(0, row(PLACEMENT_HOLDOUT)), true, 'a first row')
  assert.equal(held.hold(0, row(PLACEMENT_HOLDOUT)), false, 'the same row')
  assert.equal(held.hold(0, row(0)), true, 'other bits')
  assert.equal(held.hold(0, { ...row(0), most: 2 }), true, 'another word')
  assert.equal(held.hold(0, undefined), true, 'a row dropped')
  assert.equal(held.hold(0, undefined), false, 'none held')
})

test('the channelled count follows the rows, and the roots that ask `always` are the ones listed', () => {
  const held = createRootOffsets()
  held.hold(0, row(3 << PLACEMENT_CHANNELS_SHIFT))
  held.hold(1, row(0, 'always'))
  held.hold(2, row(PLACEMENT_HOLDOUT, 'always'))
  assert.equal(held.channelled(), 1)
  assert.deepEqual(held.always(), [1, 2])
  held.hold(1, row(0))
  assert.deepEqual(held.always(), [2], 'a root that stops asking leaves the list')
  held.hold(0, row(0))
  assert.equal(held.channelled(), 0)
})

test('a session that holds fewer roots keeps no row of those it lost', () => {
  const held = createRootOffsets()
  const bits = (3 << PLACEMENT_CHANNELS_SHIFT) | PLACEMENT_HOLDOUT
  for (let rank = 0; rank < 4; rank++) held.hold(rank, row(bits, 'always'))
  assert.equal(held.channelled(), 4)
  held.shrink(2)
  assert.equal(held.channelled(), 2, 'the lost roots count no more')
  assert.deepEqual(held.always(), [0, 1])
  assert.equal(held.rowOf(3), undefined)
  assert.equal(held.rowOf(1)?.bits, bits)
  held.shrink(0)
  assert.equal(held.channelled(), 0)
})

test('the roots whose objects ask for the custom depth are listed, and the count moves only when the set does', () => {
  const offsets = createRootOffsets()
  const asks = { ...row(0), customDepth: 1 << 16 }
  assert.equal(offsets.customDepthRevision(), 0)
  offsets.hold(2, asks)
  offsets.hold(3, row(0))
  assert.deepEqual([...offsets.askingCustomDepth()], [2])
  assert.equal(offsets.customDepthRevision(), 1)
  // Another stencil value is the same request: the set did not move.
  offsets.hold(2, { ...asks, customDepth: (1 << 16) | 5 })
  assert.equal(offsets.customDepthRevision(), 1)
  offsets.hold(2, row(0))
  assert.equal(offsets.askingCustomDepth().size, 0)
  assert.equal(offsets.customDepthRevision(), 2)
  offsets.hold(4, asks)
  offsets.clear()
  assert.equal(offsets.askingCustomDepth().size, 0)
})
