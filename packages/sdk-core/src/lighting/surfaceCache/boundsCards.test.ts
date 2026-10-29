import test from 'node:test'
import assert from 'node:assert/strict'
import { meshCardsFromBounds } from './boundsCards.ts'
import { directionIndex } from './cardTypes.ts'

const cards = meshCardsFromBounds(-1, [-1, -2, -3, 3, 2, 1])

test('a mesh made from bounds has six cards, one for each direction, and is mostly two-sided', () => {
  assert.equal(cards.cards.length, 6)
  assert.deepEqual(
    cards.cards.map((card) => card.direction),
    [0, 1, 2, 3, 4, 5],
  )
  assert.equal(cards.mostlyTwoSided, true)
  assert.equal(cards.hlodCell, false)
  assert.deepEqual([...cards.min], [-1, -2, -3])
  assert.deepEqual([...cards.max], [3, 2, 1])
})

test('each card faces its direction on three distinct axes of the object space, the first crossed with the second the facing one reversed', () => {
  for (const card of cards.cards) {
    const axes = [card.axisX, card.axisY, card.axisZ].map(directionIndex)
    assert.ok(axes.every((axis) => axis >= 0))
    assert.equal(new Set(axes.map((axis) => axis >> 1)).size, 3)
    assert.equal(directionIndex(card.axisZ), card.direction)
    const [x, y, z] = [card.axisX, card.axisY, card.axisZ]
    const handed = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
    assert.deepEqual(
      handed.map((c) => c + 0),
      z.map((c) => -c + 0),
    )
  }
})

test('a card is the box along its axes, five centimetres deeper, its centre moved forward by as much', () => {
  // The centre is (1, 0, -1); the half extents (2, 2, 2).
  const up = cards.cards[3]
  assert.deepEqual(
    [...up.origin].map((c) => Number(c.toFixed(6))),
    [1, 0.05, -1],
  )
  assert.deepEqual(
    [...up.extent].map((c) => Number(c.toFixed(6))),
    [2, 2, 2.05],
  )
  const wide = meshCardsFromBounds(-2, [0, 0, 0, 4, 2, 6]).cards
  // Facing +x: the extents along its own axes are the box's along them, depth last.
  const side = wide[1]
  assert.deepEqual(
    [...side.origin].map((c) => Number(c.toFixed(6))),
    [2.05, 1, 3],
  )
  const along = [side.axisX, side.axisY].map(
    (axis) => Math.abs(axis[1]) * 1 + Math.abs(axis[2]) * 3 + Math.abs(axis[0]) * 2,
  )
  assert.deepEqual([...side.extent].slice(0, 2), along)
  assert.equal(side.extent[2], 2.05)
})
