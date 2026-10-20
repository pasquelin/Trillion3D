// A transparent surface in front of the opaque depth stops the one march as a wall does, and the hit
// says it is one: the reflection keeps it, a reader of walls alone — the contact shadow — skips it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { falling, marcher } from './march.fixture.ts'

const W = 128,
  H = 64

test('a transparent surface in front of the depth stops a ray as a wall does, and says it is one', () => {
  // The same wall, one pixel wide at x = 80 over a far floor, once opaque and once a transparent
  // pane over the floor: the ray stops on both, and only the pane's hit is flagged.
  const { o, d } = falling(20, 120, 30, 80, 0.5, 0.01)
  const opaque = marcher(W, H, (x) => (x === 80 ? 0.5 : 0.1)).hit(o, d)
  const pane = marcher(
    W,
    H,
    () => 0.1,
    (x) => (x === 80 ? 0.5 : 0),
  ).hit(o, d)
  assert.ok(opaque.at && pane.at, 'both hit')
  assert.deepEqual(pane.at, opaque.at, 'the same place')
  assert.equal(opaque.transparent, false, 'a wall of the opaque depth')
  assert.equal(pane.transparent, true, 'a surface in front of the opaque depth')
  // A pane behind the opaque depth is no surface of the depth at all.
  const hidden = marcher(
    W,
    H,
    (x) => (x === 80 ? 0.9 : 0.1),
    (x) => (x === 80 ? 0.5 : 0),
  ).hit(o, d)
  assert.equal(hidden.transparent, false)
})
