// The reflection's view uniform, as each image writes it: the pixel scale, the geometry of a surface's
// thickness, the held image and whether the screen traces, written only when they changed, and
// nothing in them turning with the frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import type { HeldImage } from './radiance.ts'
import { createReflectionViewWriter } from './viewWrite.ts'

/** A device whose queue lays each write into the words of one view uniform: what the buffer holds
 *  after each call, and the writes it took. */
function viewDevice() {
  const words = new Float32Array(REFLECTION_VIEW_WORDS + 16),
    bits = new Uint32Array(words.buffer)
  const held = { words, bits, writes: 0, last: 0 }
  const device = {
    queue: {
      writeBuffer: (_: unknown, at: number, w: Uint32Array, from: number, count: number) => {
        bits.set(w.subarray(from, from + count), at / 4)
        held.writes++
        held.last = Math.max(held.last, at / 4 + count)
      },
    },
  } as unknown as GPUDevice
  return { device, buffer: { size: words.byteLength } as GPUBuffer, held }
}

test('the view uniform carries the pixel scale, the held image, the slab and whether the screen traces', () => {
  // An infinite reversed perspective of 60° vertically, the eye at the origin.
  const f = 1 / Math.tan(Math.PI / 6),
    near = 0.1
  const viewProjection = [f / 2, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0]
  const { device, buffer, held: sent } = viewDevice()
  const write = createReflectionViewWriter(device, buffer)
  const held: HeldImage = {
    valid: false,
    viewProjection: new Float64Array(16).fill(2),
    size: [200, 100],
    still: false,
  }
  const frame = {
    viewProjection,
    size: [400, 300] as const,
    depthDrawn: true,
    proxyError: 0.1,
  }
  write(frame, held, 8)
  const { words, bits: traced } = sent
  // The world size of a pixel one unit away: 2·tan(30°) / 300, a perspective whose depth at an
  // infinite distance is zero.
  assert.ok(
    Math.abs(words[REFLECTION_VIEW_AT.slab] / ((2 * Math.tan(Math.PI / 6)) / 300) - 1) < 1e-6,
  )
  assert.deepEqual(
    [...words.slice(REFLECTION_VIEW_AT.slab + 1, REFLECTION_VIEW_AT.slab + 4)],
    [0, 0, 1],
  )
  assert.deepEqual(
    [
      words[REFLECTION_VIEW_AT.radiance],
      words[REFLECTION_VIEW_AT.radiance + 1],
      words[REFLECTION_VIEW_AT.radiance + 2],
    ],
    [200, 100, 7],
  )
  assert.equal(words[REFLECTION_VIEW_AT.radianceViewProj], 2, "the held image's view-projection")
  assert.equal(traced[REFLECTION_VIEW_AT.traced], 0, 'no held image: the environment alone')
  assert.deepEqual(
    [...words.slice(REFLECTION_VIEW_AT.proxy, REFLECTION_VIEW_AT.proxy + 1)],
    [Math.fround(0.1)],
  )
  assert.ok(sent.last <= REFLECTION_VIEW_WORDS, 'the view and no word past it')
  assert.deepEqual(
    [...words.slice(REFLECTION_VIEW_AT.surroundings, REFLECTION_VIEW_AT.surroundings + 4)],
    [0, 0, 0, 0],
    'no background declared: a ray that leaves the scene reaches the environment',
  )
  write(frame, { ...held, valid: true }, 8)
  assert.equal(traced[REFLECTION_VIEW_AT.traced], 1)
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  assert.equal(traced[REFLECTION_VIEW_AT.traced], 0, 'a stale depth is never marched')
  // A still view writes once: nothing in the words turns with the frame.
  const writes = sent.writes
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  assert.equal(sent.writes, writes)
})

test("the slab follows the projection: a perspective's depth at infinity, an orthographic one's step", () => {
  const slab = (viewProjection: number[], size: readonly [number, number]) => {
    const { device, buffer, held: sent } = viewDevice()
    const held: HeldImage = {
      valid: false,
      viewProjection: new Float64Array(16),
      size: [0, 0],
      still: false,
    }
    createReflectionViewWriter(device, buffer)(
      { viewProjection, size, depthDrawn: true, proxyError: 0 },
      held,
      1,
    )
    return [...sent.words.slice(REFLECTION_VIEW_AT.slab, REFLECTION_VIEW_AT.slab + 4)]
  }
  // A finite reversed perspective, near 0.1 and far 100: z = n(f − w) / (w(f − n)) = A + B / w.
  const n = 0.1,
    far = 100
  const finite = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, n / (far - n), -1, 0, 0, (n * far) / (far - n), 0]
  const [scale, atInfinity, step, perspective] = slab(finite, [1000, 500])
  assert.equal(scale, Math.fround(0.004))
  assert.ok(Math.abs(atInfinity - -n / (far - n)) < 1e-6, `${atInfinity}`)
  assert.deepEqual([step, perspective], [0, 1])
  // An orthographic projection: its depth spans `scale · |∇z|` for a pixel's thickness.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]
  assert.deepEqual(slab(identity, [10, 4]), [0.5, 0, 1, 0])
})
