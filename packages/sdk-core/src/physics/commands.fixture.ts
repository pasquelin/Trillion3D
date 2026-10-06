// The command words the tests of `commands.ts` read, and the body they add.
import type { BodyRecord } from './bodyRecord.ts'
import { SHAPE } from './layout.ts'

/** The words and the same words read as floats. */
export const read = (words: Uint32Array) => ({ words, floats: new Float32Array(words.buffer) })
export const body: BodyRecord = {
  ...{ id: 19, motion: 1, layer: 2, shape: SHAPE.box, flags: 7 },
  ...{ position: [1, 2, 3], quaternion: [0, 0, 0, 1], size: [2, 3, 4] },
  ...{ mass: 5, density: 6, friction: 0.25, restitution: 0.5, gravityScale: 1 },
}
