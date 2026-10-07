// The world rebase (`packages/sdk-browser/src/gpu/dag/worldRebase.ts`) as the mock device replays
// it: each placement's translation words from the exact doubles behind the range's matrices, the
// eye's doubles taken off, in double, then single precision — the bits the kernel writes
// (`worldRebase.test.ts` proves the kernel's text against the same subtraction).
import type { ComputeBind } from './mockCompute.ts'

const bits = new Float64Array(1),
  halves = new Uint32Array(bits.buffer)
/** The double whose words, high then low, are `words[at]`, `words[at + 1]`. */
function double(words: Uint32Array, at: number) {
  halves[1] = words[at]
  halves[0] = words[at + 1]
  return bits[0]
}

/** Replays one range's `rebaseWorlds` dispatch on the buffers its group binds. */
export function replayWorldRebase(bind: ComputeBind) {
  const entry = (binding: number) => bind.entries.find((e) => e.binding === binding)!.resource
  const uniform = entry(0) as { buffer: { data: Uint8Array }; offset?: number },
    worldsData = entry(1).buffer.data
  const params = new Uint32Array(
    uniform.buffer.data.buffer,
    uniform.buffer.data.byteOffset + (uniform.offset ?? 0),
    8,
  )
  const count = params[0],
    eye = [0, 1, 2].map((a) => double(params, 2 + 2 * a))
  const floats = new Float32Array(worldsData.buffer, worldsData.byteOffset, count * 24),
    words = new Uint32Array(worldsData.buffer, worldsData.byteOffset, count * 24)
  for (let i = 0; i < count; i++)
    for (let a = 0; a < 3; a++)
      floats[i * 16 + 12 + a] = double(words, count * 16 + i * 8 + 2 * a) - eye[a]
}
