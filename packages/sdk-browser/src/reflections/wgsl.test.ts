// The reflection's cone and fades, and its view, shipped WGSL and TypeScript run as JavaScript
// (`shaderRun`): the cone's half-angle at the GGX lobe's half maximum, the fades that blend the
// screen into the environment — the image's edge, the thickness, the march's length, the roughness
// —, and the view uniform each image writes, in which nothing turns with the frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import {
  REFLECTION_CONE_WGSL,
  REFLECTION_EDGE,
  REFLECTION_FADE_ROUGHNESS,
  REFLECTION_ITERATIONS,
  REFLECTION_TRACE_ROUGHNESS,
  REFLECTION_VIEW_WRITTEN_BYTES,
  reflectedRadianceWgsl,
} from './wgsl.ts'
import { writeReflectionView, type ScreenReflection } from './gpu.ts'

type Cone = {
  reflectionConeTangent: (alpha: number) => number
  reflectionEdgeFade: (pixel: number[], size: number[]) => number
  reflectionThicknessFade: (gap: number, thickness: number) => number
  reflectionLengthFade: (iterations: number) => number
  reflectionTraceWeight: (rough: number) => number
}
const cone = shaderRun<Cone>(
  wgslModule(REFLECTION_CONE_WGSL),
  [
    'reflectionConeTangent',
    'reflectionEdgeFade',
    'reflectionThicknessFade',
    'reflectionLengthFade',
    'reflectionTraceWeight',
  ],
  {},
)

test('the cone is closed on a mirror and opens with the lobe, as GGX at half its peak', () => {
  assert.equal(cone.reflectionConeTangent(0), 0)
  // Wider at every α, until the half-vector's angle reaches its 40° bound.
  let last = 0
  for (let alpha = 0.05; alpha <= 1; alpha += 0.05) {
    const tangent = cone.reflectionConeTangent(alpha)
    assert.ok(alpha > 0.6 ? tangent >= last : tangent > last, `wider at ${alpha}`)
    last = tangent
  }
  // Small α: the half-vector's half-maximum angle is α√(√2 − 1), the reflected cone's twice it.
  const alpha = 0.01
  assert.ok(
    Math.abs(cone.reflectionConeTangent(alpha) / (2 * alpha * Math.sqrt(Math.SQRT2 - 1)) - 1) <
      1e-3,
  )
  assert.ok(Number.isFinite(cone.reflectionConeTangent(1)))
})

test('a hit fades into the environment at the image edge, smoothly and only there', () => {
  const size = [320, 200],
    border = REFLECTION_EDGE * size[1]
  assert.equal(cone.reflectionEdgeFade([160, 100], size), 1)
  assert.equal(cone.reflectionEdgeFade([border, border], size), 1)
  for (const at of [
    [0, 100],
    [320, 100],
    [160, 0],
    [160, 200],
  ])
    assert.equal(cone.reflectionEdgeFade(at, size), 0)
  let last = 0
  for (let x = 0; x <= border; x += border / 64) {
    const fade = cone.reflectionEdgeFade([x, 100], size)
    assert.ok(fade >= last && fade - last < 0.05, 'no step')
    last = fade
  }
  assert.equal(cone.reflectionEdgeFade([3, 100], size), cone.reflectionEdgeFade([317, 100], size))
})

test('a hit away from its surface fades out over the thickness, smoothly', () => {
  const thickness = 2
  assert.equal(cone.reflectionThicknessFade(0, thickness), 1)
  assert.equal(cone.reflectionThicknessFade(0.5 * thickness, thickness), 0.25)
  assert.equal(cone.reflectionThicknessFade(thickness, thickness), 0)
  assert.equal(cone.reflectionThicknessFade(10 * thickness, thickness), 0)
  let last = 1
  for (let gap = 0; gap <= thickness; gap += thickness / 64) {
    const fade = cone.reflectionThicknessFade(gap, thickness)
    assert.ok(fade <= last && last - fade < 0.05, 'no step')
    last = fade
  }
})

test('a march fades over its last quarter of iterations, none at their bound', () => {
  assert.equal(cone.reflectionLengthFade(0), 1)
  assert.equal(cone.reflectionLengthFade(0.75 * REFLECTION_ITERATIONS), 1)
  assert.equal(cone.reflectionLengthFade(REFLECTION_ITERATIONS), 0)
  assert.ok(Math.abs(cone.reflectionLengthFade(0.875 * REFLECTION_ITERATIONS) - 0.5) < 1e-9)
})

test('the screen gives way to the environment over the trace roughness range', () => {
  assert.equal(cone.reflectionTraceWeight(0), 1)
  assert.equal(cone.reflectionTraceWeight(REFLECTION_FADE_ROUGHNESS), 1)
  assert.equal(cone.reflectionTraceWeight(REFLECTION_TRACE_ROUGHNESS), 0)
  assert.equal(cone.reflectionTraceWeight(1), 0)
  const mid = cone.reflectionTraceWeight(
    (REFLECTION_FADE_ROUGHNESS + REFLECTION_TRACE_ROUGHNESS) / 2,
  )
  assert.ok(Math.abs(mid - 0.5) < 1e-6)
})

test('the view uniform carries the pixel scale, the held image, the display and whether the screen traces', () => {
  // An infinite reversed perspective of 60° vertically, the eye at the origin.
  const f = 1 / Math.tan(Math.PI / 6),
    near = 0.1
  const viewProjection = [f / 2, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0]
  const written: Float32Array[] = []
  const reflection = {
    words: new Float32Array(REFLECTION_VIEW_WRITTEN_BYTES / 4),
    levels: 8,
    held: { valid: false, viewProjection: new Float64Array(16).fill(2), size: [200, 100] },
    device: {
      queue: { writeBuffer: (_: unknown, __: number, w: Float32Array) => written.push(w.slice()) },
    },
  } as unknown as ScreenReflection
  const frame = {
    viewProjection,
    inverseViewProjection: viewProjection,
    camera: [0, 0, 0, 1],
    size: [400, 300] as const,
    depthDrawn: true,
    display: { background: [0.25, 0.5, 0.75] as const, exposure: 2, curve: 4 },
  }
  writeReflectionView(reflection, frame)
  const words = written[0],
    counts = new Uint32Array(words.buffer)
  // The world size of a pixel one unit away: 2·tan(30°) / 300.
  assert.ok(Math.abs(words[54] / ((2 * Math.tan(Math.PI / 6)) / 300) - 1) < 1e-6)
  assert.deepEqual([words[52], words[53], words[56], words[57], words[58]], [400, 300, 200, 100, 7])
  assert.equal(words[32], 2, "the held image's view-projection")
  assert.equal(counts[60], 0, 'no held image: the environment alone')
  assert.equal(counts[61], 4, "the display curve's rank")
  assert.deepEqual([...words.slice(64, 68)], [0.25, 0.5, 0.75, 2])
  assert.equal(words.length * 4, REFLECTION_VIEW_WRITTEN_BYTES, 'the surroundings are not written')
  reflection.held.valid = true
  writeReflectionView(reflection, frame)
  assert.equal(new Uint32Array(written[1].buffer)[60], 1)
  writeReflectionView(reflection, { ...frame, depthDrawn: false })
  assert.equal(new Uint32Array(written[2].buffer)[60], 0, 'a stale depth is never marched')
  // A still view writes the same words: nothing in them turns with the frame.
  writeReflectionView(reflection, frame)
  assert.deepEqual(written[3], written[1])
})

test('nothing a reflection reads turns with the frame: no seed, no frame rank, no history', () => {
  const text = wgslModule(reflectedRadianceWgsl(1))
  for (const name of ['jitter', 'frame', 'seed', 'noise', 'history', 'random', 'hash'])
    assert.doesNotMatch(text, new RegExp(`\\b${name}\\b`, 'i'), name)
})
