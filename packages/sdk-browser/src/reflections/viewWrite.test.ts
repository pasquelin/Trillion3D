// The reflection's view uniform, as each image writes it: the pixel scale, the held image, the
// display and whether the screen traces, written only when they changed, and nothing in them
// turning with the frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_VIEW_AT as AT, REFLECTION_VIEW_WRITTEN_WORDS } from './viewLayout.ts'
import { createReflectionViewWriter } from './viewWrite.ts'

test('the view uniform carries the pixel scale, the held image, the display and whether the screen traces', () => {
  // An infinite reversed perspective of 60° vertically, the eye at the origin.
  const f = 1 / Math.tan(Math.PI / 6),
    near = 0.1
  const viewProjection = [f / 2, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0]
  const written: Float32Array[] = []
  const device = {
    queue: { writeBuffer: (_: unknown, __: number, w: Float32Array) => written.push(w.slice()) },
  } as unknown as GPUDevice
  const write = createReflectionViewWriter(device, {} as GPUBuffer)
  const held = {
    valid: false,
    viewProjection: new Float64Array(16).fill(2),
    size: [200, 100],
  } as const
  const frame = {
    viewProjection,
    inverseViewProjection: viewProjection,
    camera: [0, 0, 0, 1],
    size: [400, 300] as const,
    depthDrawn: true,
    background: [0.25, 0.5, 0.75],
    exposure: 2,
    curve: 4,
  }
  write(frame, held, 8)
  const words = written[0],
    counts = new Uint32Array(words.buffer)
  // The world size of a pixel one unit away: 2·tan(30°) / 300.
  assert.ok(Math.abs(words[AT.screen + 2] / ((2 * Math.tan(Math.PI / 6)) / 300) - 1) < 1e-6)
  assert.deepEqual(
    [
      words[AT.screen],
      words[AT.screen + 1],
      words[AT.radiance],
      words[AT.radiance + 1],
      words[AT.radiance + 2],
    ],
    [400, 300, 200, 100, 7],
  )
  assert.equal(words[AT.radianceViewProj], 2, "the held image's view-projection")
  assert.equal(counts[AT.counts], 0, 'no held image: the environment alone')
  assert.equal(counts[AT.counts + 1], 4, "the display curve's rank")
  assert.deepEqual([...words.slice(AT.display, AT.display + 4)], [0.25, 0.5, 0.75, 2])
  assert.equal(words.length, REFLECTION_VIEW_WRITTEN_WORDS, 'the surroundings are not written')
  write(frame, { ...held, valid: true }, 8)
  assert.equal(new Uint32Array(written[1].buffer)[AT.counts], 1)
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  assert.equal(new Uint32Array(written[2].buffer)[AT.counts], 0, 'a stale depth is never marched')
  // A still view writes once: nothing in the words turns with the frame.
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  write({ ...frame, depthDrawn: false }, { ...held, valid: true }, 8)
  assert.equal(written.length, 3)
})
