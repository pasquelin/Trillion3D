// What a root's world decides on the CPU is taken when read (`rootWorld.ts`): a root made or a move
// no one reads transforms no box and solves no stretch; a read after it is the formula's at the new world, to
// the bit; a read before it is taken is the box the root leaves; a world a parent composes moves
// both with its own stamp.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxTransform } from '../../../../math/src/geometry/box.ts'
import { maxStretch } from '../../../../math/src/projection/projectionOracles.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { generated } from '../../placement/composeDoubles.fixture.ts'
import { rootWorldBox, worldMoved, worldStretch, type WorldMemo } from './rootWorld.ts'

/** A root of a generated local box, posed by `elements`. */
const rootAt = (elements: Float64Array): WorldMemo => ({
  world: { elements },
  localBox: Float64Array.of(-1, -2, -0.5, 3, 1, 2),
  worldBox: new Float64Array(6),
})

const expectedBox = (root: WorldMemo) => {
  const out = new Float64Array(6)
  boxTransform(out, 0, root.localBox!, 0, root.world.elements)
  return Array.from(out)
}

test('a move no one reads takes no box; a read after it is the formula’s, to the bit', () => {
  const next = lcgRandom(5),
    elements = generated(next, 1e4),
    root = rootAt(elements)
  assert.deepEqual(Array.from(root.worldBox!), new Array(6).fill(0), 'a root made takes none')
  assert.deepEqual(Array.from(rootWorldBox(root)!), expectedBox(root), 'its first read takes it')
  const left = Array.from(root.worldBox!)
  for (let k = 0; k < 20; k++) {
    elements.set(generated(next, 1e4))
    worldMoved(root)
  }
  assert.deepEqual(Array.from(root.worldBox!), left, 'twenty moves, no box taken')
  assert.deepEqual(Array.from(rootWorldBox(root)!), expectedBox(root), 'the read takes it')
})

test('a box read before the move is taken is the one the root leaves', () => {
  const next = lcgRandom(9),
    elements = generated(next, 10),
    root = rootAt(elements)
  const before = Array.from(rootWorldBox(root)!)
  // The owner writes the world in place; the engine takes the move after it reads what it leaves.
  elements.set(generated(next, 10))
  assert.deepEqual(Array.from(rootWorldBox(root)!), before)
  worldMoved(root)
  assert.deepEqual(Array.from(rootWorldBox(root)!), expectedBox(root))
})

test('the stretch is the memo of the world’s stamp, a composed world’s own stamp included', () => {
  const next = lcgRandom(13),
    elements = generated(next, 10),
    root = rootAt(elements)
  assert.equal(worldStretch(root), maxStretch(elements))
  elements.set(generated(next, 10))
  worldMoved(root)
  assert.equal(worldStretch(root), maxStretch(elements))
  // A parent composes it: its stamp moves the memo, no `worldMoved` called.
  let stamp = 1
  Object.defineProperty(root.world, 'stamp', { configurable: true, get: () => stamp })
  assert.equal(worldStretch(root), maxStretch(elements))
  elements.set(generated(next, 10))
  stamp++
  assert.equal(worldStretch(root), maxStretch(elements))
  assert.deepEqual(Array.from(rootWorldBox(root)!), expectedBox(root))
})
