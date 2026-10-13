// The cut's worlds as its kernels read them (`packages/sdk-browser/src/gpu/dag/shader/worldPoseWgsl.ts`),
// replayed on the fake device: each placement's matrix in its record of the worlds' table, its
// translation the exact doubles beside it less the eye's doubles in the view block, in double, then
// single precision — the bits the kernel reads (`worldsAtEye.test.ts` proves the kernel's text
// against the same subtraction).
import { viewWord } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts'
import { WORLD_TABLE } from '../../../packages/sdk-browser/src/gpu/dag/worldTable.ts'
import { recordWordAt } from '../../../packages/sdk-browser/src/gpu/core/recordTexture.fixture.ts'
import { words } from './fakeBuffers.ts'
import type { FakeTexture } from './fakeRecords.ts'

const bits = new Float64Array(1),
  halves = new Uint32Array(bits.buffer)
/** The double whose words, high then low, are `held[at]`, `held[at + 1]`. */
function double(held: Uint32Array, at: number) {
  halves[1] = held[at]
  halves[0] = held[at + 1]
  return bits[0]
}

/** The texture a bound view names (`fakeResources.ts`, `createView`). */
export const viewTexture = (view: unknown) => (view as { texture: FakeTexture }).texture

/** The first `length / 16` worlds of the bound worlds' table `worlds` at the eye of the view block
 *  `views`: a copy, the table left as written. */
export function worldsAtEye(worlds: FakeTexture, views: Uint8Array, length: number) {
  const view = words(views),
    eye = [0, 1, 2].map((a) => double(view, viewWord('eye') + 2 * a)),
    held = worlds.words ?? new Uint32Array(worlds.width * worlds.height * 4)
  const out = new Float32Array(length)
  for (let i = 0; i < length / 16; i++) {
    const matrix = recordWordAt(WORLD_TABLE, worlds, 'Matrix', i),
      origin = recordWordAt(WORLD_TABLE, worlds, 'Origin', i)
    out.set(new Float32Array(held.buffer, held.byteOffset + matrix * 4, 16), i * 16)
    for (let a = 0; a < 3; a++) out[i * 16 + 12 + a] = double(held, origin + 2 * a) - eye[a]
  }
  return out
}
