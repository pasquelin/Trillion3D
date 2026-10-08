// The cards follow the root list they are planned over: a new list clears every card bit the old
// one set — a root carded far away and near now draws its clusters, never a hole —, and a root
// appended to the list in place takes its card at its own radius, never a card of no size.
import test from 'node:test'
import assert from 'node:assert/strict'
import './lent.fixture.ts'
import { createImpostorCards, planImpostorCards } from './cards.ts'
import { CARD_FLOATS } from './cardSlots.ts'
import { engineAt, impostorScene, impostorSection, VIEWPORT } from './section.fixture.ts'
import { CARD_ROOT } from '../visibility/shader/spriteWgsl.ts'

const GROUP = { atlas: 1 }

test('a new root list clears the card bits the old one set', () => {
  const { fixture, roots } = impostorScene(),
    state = createImpostorCards<typeof GROUP>(impostorSection)
  planImpostorCards(state, roots, engineAt(200), VIEWPORT, () => GROUP)
  assert.equal(roots[0].mark, CARD_ROOT, 'far away, the root is its card')
  // The same roots in a new list, the camera near: the root draws its clusters again.
  const again = [...roots]
  planImpostorCards(state, again, engineAt(5), VIEWPORT, () => GROUP)
  assert.equal(again[0].mark ?? 0, 0, 'no card bit left without its card')
  assert.equal(state.count, 0)
  fixture.geometry.dispose()
})

test('a root appended to the list in place takes its card at its own radius', () => {
  const { fixture, roots } = impostorScene(),
    state = createImpostorCards<typeof GROUP>(impostorSection)
  planImpostorCards(state, roots, engineAt(200), VIEWPORT, () => GROUP)
  assert.equal(state.count, 1)
  // A second placement of the mesh beside the first, joined into the same list.
  const elements = Array.from(roots[0].world.elements)
  elements[12] = 0.5
  roots.push({ ...roots[0], mark: undefined, world: { elements } } as (typeof roots)[number])
  planImpostorCards(state, roots, engineAt(200), VIEWPORT, () => GROUP)
  assert.equal(roots[1].mark, CARD_ROOT)
  assert.equal(state.count, 2)
  const { records } = state.slots
  for (let card = 0; card < 2; card++)
    assert.equal(records[card * CARD_FLOATS + 43], 1, `card ${card} at the root's radius`)
  fixture.geometry.dispose()
})
