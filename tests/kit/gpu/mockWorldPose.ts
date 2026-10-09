// The cut's worlds as its kernels read them (`packages/sdk-browser/src/gpu/dag/shader/worldPoseWgsl.ts`),
// replayed on the mock device: each placement's translation the exact doubles behind the range's
// matrices less the eye's doubles in the view block, in double, then single precision — the bits
// the kernel reads (`worldsAtEye.test.ts` proves the kernel's text against the same subtraction).
import { viewWord } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts'
import { words } from './mockBuffers.ts'

const bits = new Float64Array(1),
  halves = new Uint32Array(bits.buffer)
/** The double whose words, high then low, are `held[at]`, `held[at + 1]`. */
function double(held: Uint32Array, at: number) {
  halves[1] = held[at]
  halves[0] = held[at + 1]
  return bits[0]
}

/** The worlds of a range's bound buffer — its matrices, then eight words of exact translation a
 *  placement — at the eye of the view block `views`: a copy, the bound buffer left as written. */
export function worldsAtEye(worlds: Uint8Array, views: Uint8Array, length: number) {
  const count = worlds.byteLength / 96,
    held = new Uint32Array(worlds.buffer, worlds.byteOffset, count * 24),
    view = words(views),
    eye = [0, 1, 2].map((a) => double(view, viewWord('eye') + 2 * a))
  const out = new Float32Array(worlds.buffer, worlds.byteOffset, count * 16).slice()
  for (let i = 0; i < count; i++)
    for (let a = 0; a < 3; a++)
      out[i * 16 + 12 + a] = double(held, count * 16 + i * 8 + 2 * a) - eye[a]
  return out.subarray(0, length)
}
