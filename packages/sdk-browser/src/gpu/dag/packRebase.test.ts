// The worlds the host sends the cut: each root's world in single precision, whatever the
// eye — each cut takes its eye off them as it reads them (`shader/worldPoseWgsl.ts`). Whether a pose moved is read
// against them bit for bit: a pose left alone reads unmoved, one changed past single precision
// moved, a NaN never unmoved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { rootWorlds, rootWorldsMoved } from './pack.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import type { DagRoot } from './types.ts'

const rootsOf = (worlds: Float64Array[]) =>
  worlds.map((elements) => ({ world: { elements } }) as unknown as DagRoot)

/** Worlds in double, of magnitudes from the millimetre to far beyond single precision. */
function randomWorlds(next: () => number, count: number) {
  return Array.from({ length: count }, () =>
    Float64Array.from({ length: 16 }, () => (next() - 0.5) * 10 ** Math.floor(next() * 12 - 3)),
  )
}

test('the worlds sent are each root world in single precision', () => {
  const next = random(918)
  const roots = rootsOf(randomWorlds(next, 30)),
    worlds = new Float32Array(30 * 16)
  rootWorlds(worlds, roots)
  roots.forEach((root, w) =>
    assert.deepEqual(
      [...worlds.subarray(w * 16, w * 16 + 16)],
      [...Float32Array.from(root.world.elements)],
    ),
  )
})

test('a pose left alone reads unmoved, one changed past single precision moved', () => {
  const next = random(1831)
  let visible = 0
  for (let round = 0; round < 200; round++) {
    const roots = rootsOf(randomWorlds(next, 1 + Math.floor(next() * 40)))
    const sent = new Float32Array(roots.length * 16)
    rootWorlds(sent, roots)
    assert.equal(rootWorldsMoved(sent, roots), false, `round ${round}`)
    const world = roots[Math.floor(next() * roots.length)].world.elements as Float64Array,
      at = Math.floor(next() * 16)
    world[at] = world[at] * 2 + 1
    const fresh = new Float32Array(sent.length)
    rootWorlds(fresh, roots)
    const seen = fresh.some((value, i) => value !== sent[i])
    assert.equal(rootWorldsMoved(sent, roots), seen, `element ${at}`)
    if (seen) visible++
  }
  assert.ok(visible > 100, 'most changes reach single precision')
})

test('a NaN pose never reads unmoved; no root never moved', () => {
  const roots = rootsOf([Float64Array.from({ length: 16 }, (_, i) => (i === 13 ? NaN : i))])
  const sent = new Float32Array(16)
  rootWorlds(sent, roots)
  assert.equal(rootWorldsMoved(sent, roots), true)
  assert.equal(rootWorldsMoved(sent, []), false)
})
