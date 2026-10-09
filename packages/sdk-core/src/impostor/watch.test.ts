// The watch holds the plan's switch for every root in view, image after image, and reads a root
// again only once the view may have moved its verdict: a still view reads nothing, a swaying or
// turning one what nears its switch — as many at 10⁵ roots as at 10³, on generated fields of one
// density.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planImpostors } from './plan.ts'
import { createImpostorWatch } from './watch.ts'
import { COS, FOCAL, field, inView, section, swayAt } from './watch.fixture.ts'

test('the watch holds the plan’s verdict for every root in view, still, swaying and turning', () => {
  const roots = field(3000),
    watch = createImpostorWatch()
  let checked = 0
  for (let k = 0; k < 90; k++) {
    const view = k < 10 ? swayAt(0) : swayAt(k, k >= 50 ? 0.02 : 0)
    watch.update(roots, section, view, FOCAL, COS)
    const plan = planImpostors(roots, section, view, FOCAL)
    for (let rank = 0; rank < roots.length; rank++) {
      if (!inView(view, roots[rank])) continue
      checked++
      assert.equal(watch.switched[rank], plan.switched[rank], `frame ${k}, root ${rank}`)
    }
  }
  assert.ok(checked > 3000, `${checked} roots checked in view`)
})

/** Reads per image of a field of `count` roots: the first, still images, then a sway and a turn. */
function readsOf(count: number) {
  const roots = field(count),
    watch = createImpostorWatch()
  // Each root read is asked once whether it may take a card: the reads counted there.
  let reads = 0
  const update = (view: ReturnType<typeof swayAt>) => {
    reads = 0
    watch.update(roots, section, view, FOCAL, COS, () => (reads++, true))
    return reads
  }
  const first = update(swayAt(0))
  let still = 0
  for (let k = 0; k < 8; k++) still += update(swayAt(0)) + watch.changedCount
  let moving = 0,
    changed = 0
  for (let k = 1; k <= 120; k++) {
    moving += update(swayAt(k, k > 60 ? 0.01 : 0))
    changed += watch.changedCount
  }
  return { first, still, moving: moving / 120, changed: changed / 120 }
}

test('a still view reads nothing; a moving one what nears its switch, flat in the field’s size', () => {
  const counts = [1e3, 1e4, 1e5].map(readsOf)
  for (const [i, { first, still }] of counts.entries()) {
    assert.equal(first, [1e3, 1e4, 1e5][i], 'the first image reads every root once')
    assert.equal(still, 0, 'a still view reads and changes nothing')
  }
  const [small, , large] = counts
  console.log(
    counts
      .map(({ moving, changed }) => `${moving.toFixed(1)} read, ${changed.toFixed(1)} switched`)
      .join(' · '),
  )
  assert.ok(
    large.moving <= 1.5 * small.moving + 20,
    `${large.moving} reads at 10⁵ against ${small.moving}`,
  )
  assert.ok(large.moving <= 40 * (large.changed + 1), 'reads bounded by the switches')
})
