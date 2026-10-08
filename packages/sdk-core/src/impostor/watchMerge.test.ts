// A camera that moves on and on past the watch's sixteen anchors pays for what it reads: an old
// pair of anchors is merged, each root moved at most once per read, the newest — which the reads
// fill — never re-pushed. On a generated field of 4000 roots, 300 frames of steady motion.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createImpostorWatch } from './watch.ts'
import { COS, FOCAL, field, keptHeaps, section, viewAt } from './watch.fixture.ts'

test('a steady motion past sixteen anchors takes about one heap place a read', () => {
  let reads = 0
  // The watch's heaps, each push counted once the motion has settled; each root read is asked
  // once whether it may take a card.
  const heaps = keptHeaps()
  const roots = field(4000),
    watch = createImpostorWatch(heaps.make)
  const carded = () => ((reads += heaps.counting ? 1 : 0), true)
  for (let frame = 0; frame < 300; frame++) {
    heaps.counting = frame >= 100
    watch.update(roots, section, viewAt([frame * 3, 2, 0], 0), FOCAL, COS, carded)
  }
  assert.ok(reads > 0, 'the motion reads roots')
  // A read takes one place, and a root merged out of an old anchor one more: never a heap whole.
  assert.ok(heaps.pushes <= 2 * reads, `${heaps.pushes} places for ${reads} reads`)
  assert.ok(heaps.waiting() <= roots.length, 'one place a root at most')
})
