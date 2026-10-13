// The reflection's cone and fades, and its view, shipped WGSL and TypeScript run as JavaScript
// (`shaderRun`): the cone's half-angle at the GGX lobe's half maximum, the fades that blend the
// screen into the environment — the image's edge, the footprint's pyramid level —, and that nothing the reflection reads turns with the frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { withoutComments } from '../../../math/src/wgsl/comments.fixture.ts'
import { REFLECTION_CONSTANTS } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './footprint.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'

type Cone = {
  reflectionConeTangent: (alpha: number) => number
  reflectionEdgeFade: (pixel: number[], size: number[]) => number
  reflectionLevelTrust: (level: number, top: number) => number
}
const cone = shaderRun<Cone>(
  wgslModule(REFLECTION_CONE_WGSL),
  ['reflectionConeTangent', 'reflectionEdgeFade', 'reflectionLevelTrust'],
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
    border = REFLECTION_CONSTANTS.REFLECTION_EDGE * size[1]
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

test('the screen gives way to the environment over the last level below the pyramid top, smoothly', () => {
  const top = 8
  assert.equal(cone.reflectionLevelTrust(0, top), 1)
  assert.equal(cone.reflectionLevelTrust(top - 1, top), 1)
  assert.equal(cone.reflectionLevelTrust(top, top), 0)
  assert.equal(cone.reflectionLevelTrust(top + 3, top), 0)
  assert.ok(Math.abs(cone.reflectionLevelTrust(top - 0.5, top) - 0.5) < 1e-6)
  let last = 1
  for (let level = top - 1; level <= top; level += 1 / 64) {
    const trust = cone.reflectionLevelTrust(level, top)
    assert.ok(trust <= last && last - trust < 0.05, 'no step')
    last = trust
  }
})

test('nothing a reflection reads turns with the frame: no seed, no frame rank, no history', () => {
  // The code, not the declarations nor the comments: the bounce grid it shares with the diffuse
  // declares the probe update's frame counters, which nothing here reads.
  const text = withoutComments(
    wgslModule(reflectedRadianceWgsl(1, { group: 0, proxy: 20 })),
  ).replace(/struct \w+\{[^}]*\}/g, '')
  for (const name of ['jitter', 'seed', 'noise', 'history', 'random', 'hash'])
    assert.doesNotMatch(text, new RegExp(`\\b${name}\\b`, 'i'), name)
  // The frame's rank is a member of the cascades' grid (`bounce.frame`) and of nothing else; the
  // proxy's tree names a box its `frame`, a parameter.
  assert.doesNotMatch(text, /\.frame\b/, 'the rank of the frame')
})
