// A card follows the root it stands for: written from the root's world as it is now — a world
// remade on another buffer included —, and its mesh's box fitted again to its roots as one moves
// back or leaves, never only grown.
import test from 'node:test'
import assert from 'node:assert/strict'
import './lent.fixture.ts'
import { createImpostorCards, impostorWorldsMoved, planImpostorCards } from './cards.ts'
import { engineAt, impostorScene, impostorSection, MESH, VIEWPORT } from './section.fixture.ts'

const GROUP = { atlas: 1 }

/** The world translation a card's record holds, its two singles summed. */
const translation = (records: Float32Array) =>
  [0, 1, 2].map((k) => records[12 + k] + records[16 + k])

test('a card is written from its root’s world as it is now, one remade elsewhere included', () => {
  const { fixture, roots } = impostorScene(),
    state = createImpostorCards<typeof GROUP>(impostorSection, { atlasOf: () => GROUP })
  planImpostorCards(state, roots, engineAt(200), VIEWPORT)
  assert.equal(state.count, 1)
  // A growth poses the root again on a new buffer: another world object, another place.
  const elements = Float64Array.from(roots[0].world.elements)
  elements[12] = 2.5
  roots[0].world = { ...roots[0].world, elements } as (typeof roots)[0]['world']
  impostorWorldsMoved(state)
  planImpostorCards(state, roots, engineAt(200), VIEWPORT)
  assert.deepEqual(translation(state.slots.records), [2.5, 0, 0])
  fixture.geometry.dispose()
})

test('a mesh’s box is fitted again to its roots as one moves back', () => {
  const { fixture, roots } = impostorScene(),
    state = createImpostorCards<typeof GROUP>(impostorSection, { atlasOf: () => GROUP })
  // A second placement of the mesh beside the first.
  const beside = Float64Array.from(roots[0].world.elements)
  beside[12] = -3
  roots.push({ ...roots[0], mark: undefined, world: { elements: beside } } as (typeof roots)[0])
  roots[0].world = {
    elements: Float64Array.from(roots[0].world.elements),
  } as (typeof roots)[0]['world']
  planImpostorCards(state, roots, engineAt(200), VIEWPORT)
  const box = () => Array.from(state.segments.get(MESH)!.box)
  const settled = box()
  const elements = roots[0].world.elements as Float64Array
  // Out to the side, then back where it stood.
  elements[12] = 40
  impostorWorldsMoved(state, [0])
  planImpostorCards(state, roots, engineAt(200), VIEWPORT)
  assert.ok(box()[3] > 40, 'the box holds it where it went')
  elements[12] = 0
  impostorWorldsMoved(state, [0])
  planImpostorCards(state, roots, engineAt(200), VIEWPORT)
  assert.deepEqual(box(), settled, 'and no more than where it stands')
  fixture.geometry.dispose()
})
