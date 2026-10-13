// The reflection's view uniform, as each image writes it: the pixel scale, the geometry of a surface's
// thickness, the held image and whether the screen traces, written only when they changed, and
// nothing in them turning with the frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_VIEW_AT, REFLECTION_VIEW_WRITTEN_WORDS } from './viewLayout.ts'
import type { HeldImage } from './radiance.ts'
import { createReflectionViewWriter } from './viewWrite.ts'

test('the view uniform carries the pixel scale, the held image, the slab and whether the screen traces', () => {
  // An infinite reversed perspective of 60° vertically, the eye at the origin.
  const f = 1 / Math.tan(Math.PI / 6),
    near = 0.1
  const viewProjection = [f / 2, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0]
  const written: Float32Array[] = []
  const device = {
    queue: { writeBuffer: (_: unknown, __: number, w: Float32Array) => written.push(w.slice()) },
  } as unknown as GPUDevice
  const write = createReflectionViewWriter(device, {} as GPUBuffer)
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
  const words = written[0],
    traced = new Uint32Array(words.buffer)
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
  assert.equal(words.length, REFLECTION_VIEW_WRITTEN_WORDS, 'the surroundings are not written')
  write(frame, { ...held, valid: true }, 8)
  assert.equal(new Uint32Array(written[1].buffer)[REFLECTION_VIEW_AT.traced], 1)
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  assert.equal(
    new Uint32Array(written[2].buffer)[REFLECTION_VIEW_AT.traced],
    0,
    'a stale depth is never marched',
  )
  // A still view writes once: nothing in the words turns with the frame.
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  assert.equal(written.length, 3)
})

test("the slab follows the projection: a perspective's depth at infinity, an orthographic one's step", () => {
  const slab = (viewProjection: number[], size: readonly [number, number]) => {
    let words = new Float32Array(0)
    const device = {
      queue: { writeBuffer: (_: unknown, __: number, w: Float32Array) => (words = w.slice()) },
    } as unknown as GPUDevice
    const held: HeldImage = {
      valid: false,
      viewProjection: new Float64Array(16),
      size: [0, 0],
      still: false,
    }
    createReflectionViewWriter(device, {} as GPUBuffer)(
      { viewProjection, size, depthDrawn: true, proxyError: 0 },
      held,
      1,
    )
    return [...words.slice(REFLECTION_VIEW_AT.slab, REFLECTION_VIEW_AT.slab + 4)]
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
