// The impostor switch kept per root across frames by one watch. A frame reads of each root its
// pivot only, until the root is replaced or its world turns or scales; every verdict stays the one
// a watch reading from nothing gives, bit for bit, in view or not.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ImpostorRoot } from './switchTable.ts'
import { createImpostorWatch } from './watch.ts'
import { TREE_AND_BUSH, placed } from './bakedMesh.fixture.ts'
import { readFromNothing } from './watch.fixture.ts'

/** Roots that count the reads of their mesh number: the lookup of a root's entry reads it. */
function forest(count: number) {
  const reads = { mesh: 0 }
  const roots = Array.from({ length: count }, (_, i) => {
    const mesh = 1 + (i % 3 === 0 ? 1 : 0)
    const root = { world: { elements: placed(i * 3 - count, 0, -20 - i * 7, i, 1 + (i % 4) / 3) } }
    Object.defineProperty(root, 'mesh', { get: () => (reads.mesh++, mesh), enumerable: true })
    return root as ImpostorRoot
  })
  return { roots, reads }
}

/** The view of an eye at `(x, 0, z)` looking down -z. */
const viewAt = (x: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, 0, -z, 1]

test('a kept watch gives the verdicts of a watch reading from nothing, roots moved and replaced', () => {
  const { roots } = forest(120),
    watch = createImpostorWatch()
  let mixed = 0
  for (let frame = 0; frame < 40; frame++) {
    const view = viewAt(Math.sin(frame) * 30, -frame * 20)
    const focal = frame % 13 === 12 ? 700 : 1117
    // Some roots turn, scale or move; one is replaced by another of the other mesh.
    if (frame % 5 === 4) {
      roots[frame].world.elements = placed(0, 0, -50 - frame, frame, 2)
      watch.touch(frame)
    }
    if (frame % 7 === 6) {
      const moved = Array.from(roots[frame + 1].world.elements)
      moved[12] += 5
      roots[frame + 1].world.elements = moved
      watch.touch(frame + 1)
    }
    if (frame === 20) {
      roots[3] = { mesh: 1, world: { elements: placed(0, 0, -400, 0, 1) } }
      watch.touch(3)
    }
    watch.update(roots, TREE_AND_BUSH, view, focal, 0)
    const kept = [...watch.switched]
    assert.deepEqual(
      kept,
      [...readFromNothing(roots, TREE_AND_BUSH, view, focal).switched],
      `frame ${frame}`,
    )
    const cards = kept.filter((bit) => bit === 1).length
    if (cards && cards < roots.length) mixed++
  }
  assert.ok(mixed > 20, 'most frames switch some roots and keep others')
})

test('a frame reads of a still root its pivot only: no entry lookup, no stretch', () => {
  const { roots, reads } = forest(300),
    watch = createImpostorWatch()
  watch.update(roots, TREE_AND_BUSH, viewAt(0, 0), 1117, 0)
  for (let frame = 1; frame < 4; frame++) {
    reads.mesh = 0
    watch.update(roots, TREE_AND_BUSH, viewAt(frame * 10, -frame * 40), 1117, 0)
    assert.equal(reads.mesh, 0, `frame ${frame}: no root looked up again`)
  }
})
