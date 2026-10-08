// A camera that moves on and on past the watch's sixteen anchors pays for what it reads: an old
// pair of anchors is merged, each root moved at most once per read, the newest — which the reads
// fill — never re-pushed. On a generated field of 4000 roots, 300 frames of steady motion.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createImpostorWatch } from './watch.ts'
import { createHeap } from '../../../math/src/sequence/heap.ts'
import { COS, FOCAL, field, section, viewAt } from './watch.fixture.ts'

test('a steady motion past sixteen anchors takes about one heap place a read', () => {
  let reads = 0,
    pushes = 0,
    counting = false
  // The watch's heaps, each push counted once the motion has settled.
  const roots = field(4000),
    watch = createImpostorWatch((before, placed) => {
      const heap = createHeap(before, placed),
        push = heap.push
      heap.push = (rank) => ((pushes += counting ? 1 : 0), push(rank))
      return heap
    })
  for (let frame = 0; frame < 300; frame++) {
    counting = frame >= 100
    watch.update(roots, section, viewAt([frame * 3, 2, 0], 0), FOCAL, COS)
    if (counting) reads += watch.reads
  }
  assert.ok(reads > 0, 'the motion reads roots')
  // A read takes one place, and a root merged out of an old anchor one more: never a heap whole.
  assert.ok(pushes <= 2 * reads, `${pushes} places for ${reads} reads`)
  assert.ok(watch.waiting <= roots.length, 'one place a root at most')
})
