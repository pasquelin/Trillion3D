// What the cut's frame words take of the worlds: a render frame that follows the eye only moves
// their translations, so no row's read words move; the frame words carry each primitive's stretch —
// the one memo of it, `maxStretch` of its double world —, its root and its record shift.
import test from 'node:test'
import assert from 'node:assert/strict'
import { maxStretch } from '../../../../math/src/projection/projectionOracles.ts'
import { FRAME_VEC4 } from './types.ts'
import { primitiveFrameWords, primitiveWordAt, changedWorlds } from './worlds.ts'

const WORLDS = 4

/** Four world matrices with distinct scales and rotations, translations included. */
function scene() {
  const worlds = new Float32Array(WORLDS * 16)
  for (let w = 0; w < WORLDS; w++) {
    const base = w * 16,
      scale = 1 + w * 0.75
    worlds[base] = scale
    worlds[base + 5] = scale * 0.5
    worlds[base + 10] = scale * 2
    worlds[base + 15] = 1
    worlds[base + 12] = w * 3
    worlds[base + 13] = w * 5
    worlds[base + 14] = w * 7
  }
  return worlds
}
test('changedWorlds lists the rows whose read words moved; a translation alone moves none', () => {
  const previous = scene(),
    next = Float32Array.from(previous),
    into = new Int32Array(previous.length / 16)
  assert.equal(changedWorlds(previous, next, into), 0)
  next[2 * 16 + 14] += 1
  assert.equal(changedWorlds(previous, next, into), 0, 'the origins carry the translation')
  next[2 * 16 + 5] *= 2
  next[0 * 16 + 15] = 2
  assert.equal(changedWorlds(previous, next, into), 2)
  assert.deepEqual([...into.subarray(0, 2)], [0, 2])
})

test('the frame words carry each primitive stretch, root and record shift, as the kernel reads them', () => {
  const scaled = (k: number) => ({
    world: { elements: Float64Array.of(k, 0, 0, 0, 0, k / 3, 0, 0, 0, 0, 1, 0, 9, 8, 7, 1) },
  })
  const packed = {
    worldCount: 3,
    worldSources: [scaled(1), scaled(2.5), scaled(Math.PI)],
    rootNodes: Uint32Array.of(0, 0xffffffff, 17),
    // A shift below zero wraps: page 12 of the second primitive reads record 2.
    recordShift: Uint32Array.of(0, (2 - 12) >>> 0, 5),
  }
  const frames = primitiveFrameWords(packed),
    ints = new Uint32Array(frames.buffer)
  assert.equal(frames.length, 3 * FRAME_VEC4 * 4)
  for (let w = 0; w < 3; w++) {
    const at = primitiveWordAt(w)
    assert.equal(frames[at], Math.fround(maxStretch(packed.worldSources[w].world.elements)))
    assert.equal(ints[at + 1], packed.rootNodes[w])
    assert.equal(ints[at + 2], packed.recordShift[w])
  }
  assert.equal((12 + ints[primitiveWordAt(1) + 2]) >>> 0, 2)
})
