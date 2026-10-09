// A frame's motion follows the roots that moved, never the world's placements: told which moved,
// a reset takes their poses alone as the reference, an update compares them alone. A streaming
// world loses its history at every landing; its CPU must not read every placement each time.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createPlacementMotion } from './motion.ts'

/** `count` still roots whose world reads are counted, one of them `mobile`. */
function placements(count: number) {
  const reads = { count: 0 }
  const roots = Array.from({ length: count }, (_, w) => {
    const elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, w, 0, 0, 1]
    return {
      world: {
        get elements() {
          reads.count++
          return elements
        },
      },
      move: (x: number) => void (elements[12] = x),
    }
  })
  return { roots, reads }
}

for (const count of [1e3, 1e5])
  test(`${count} placements, one moving: reset and update read the one that moved`, () => {
    const { roots, reads } = placements(count)
    const motion = createPlacementMotion(fakeDevice().device, roots)
    for (let frame = 0; frame < 4; frame++) {
      roots[7].move(100 + frame)
      motion.noteMoved([7])
      reads.count = 0
      if (frame % 2) motion.update([0, 0, 0], true)
      else motion.reset()
      assert.ok(reads.count <= 2, `frame ${frame}: ${reads.count} world reads`)
    }
    // The pose taken last is the one it moved to: a frame that moved nothing shows no motion.
    motion.update([0, 0, 0], true)
    assert.equal(motion.moved, false)
  })
