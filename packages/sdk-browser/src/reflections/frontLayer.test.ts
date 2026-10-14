// The transparents' front layer (`frontLayer.ts`), the shipped WGSL run as JavaScript: a pixel's front
// surface keeps its proxy's answer in a cell of its own in the one store, never the opaque surface's; a forward fragment
// reads the radiance the trace wrote where it is the front surface of this image, one load, and the chain
// without the proxy anywhere else — no program but the trace casts a ray of the proxy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { STORE_LAYERS } from '../bounce/runtimeLayout.ts'
import { ahead, along, counters, makeStore, origin, runOver } from '../bounce/runtimeRun.fixture.ts'
import { world } from '../bounce/runtimeScene.fixture.ts'
import type { Vec } from '../bounce/runtimeOracle.fixture.ts'
import { forwardReflectionWgsl } from './weight.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'
import { RUNTIME_BINDINGS } from './traceBindings.ts'
import { TRACE_SHADER } from './trace.ts'

/** A cube ahead of the origin emitting `emission`. */
const glow = (emission: Vec) =>
  world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, ...emission, 0]] })

test('a pixel’s front surface keeps its answer in its own cell, never the opaque one’s', () => {
  const store = makeStore()
  const surfaces: [number, Vec][] = [
    [0, [3, 2, 1]],
    [1, [1, 2, 3]],
  ]
  // Each surface's ray cast within the budget and kept under the epoch's stamp.
  for (const [layer, emission] of surfaces) {
    const run = runOver(glow(emission), counters(0), 2, store)
    run.testLayer(layer)
    run.testPixel(5, 6, 0)
    run.rtAnswer(origin, ahead, 1000, 0.01)
  }
  // Read back with a frame whose budget is spent and a scene that would answer black: each surface
  // answers its own cell, no ray.
  for (const [layer, emission] of surfaces) {
    const run = runOver(glow([0, 0, 0]), counters(2 ** 30), 2, store)
    run.testLayer(layer)
    run.testPixel(5, 6, 0)
    const seen = run.rtAnswer(origin, ahead, 1000, 0.01)
    assert.ok(Math.abs(seen.confidence - 1) < 1e-4, `layer ${layer}`)
    seen.color.forEach((c, k) =>
      assert.ok(Math.abs(c - emission[k]) < 2e-2, `${layer}: ${seen.color}`),
    )
    assert.equal(run.testWork(), 0, 'no ray')
  }
  // The front's cell lies a whole store past the opaque one's; nothing past it was written.
  assert.ok(store.get([5, 6], STORE_LAYERS) !== 0)
  assert.equal(store.get([5, 6], 2 * STORE_LAYERS), 0)
})

type Reflected = { base: Vec; coat: Vec }

/** `forwardTrace` of the shipped forward program, over a front texel `texel` at every pixel, this image's
 *  front stamp `stamp`; the chain without the proxy answers `chain`. */
function forward(texel: number[], stamp: number) {
  const chain: Reflected = { base: [7, 7, 7], coat: [0, 0, 0] }
  const run = shaderRun<{
    forwardTrace: (
      P: Vec,
      N: Vec,
      V: Vec,
      rough: number,
      position: number[],
      front: boolean,
    ) => Reflected
  }>(wgslModule(forwardReflectionWgsl(1, false, 24)), ['forwardTrace', 'rtUnpackShared'], {
    frontTraced: { load: () => texel },
    reflectionView: { runtime: [2, stamp, 0, 0] },
    reflectionTrace: () => chain,
    Reflected: (base: Vec, coat: Vec) => ({ base, coat }),
  })
  return (z: number, front = true) =>
    run.forwardTrace([0, 0, 0], [0, 0, 1], [0, 0, 1], 0.1, [3.5, 4.5, z, 1], front)
}

test('a fragment of this image’s front surface reads the trace’s radiance; any other, the chain', () => {
  const pack = runOver(glow([0, 0, 0])).rtPackShared
  const z = 0.25,
    bits = new Uint32Array(new Float32Array([z]).buffer)[0]
  const texel = [pack([1, 2, 4]), pack([0.5, 0, 0]), bits, 9]
  const read = forward(texel, 9)
  const front = read(z)
  front.base.forEach((c, k) => assert.ok(Math.abs(c - [1, 2, 4][k]) < 1e-2, `${front.base}`))
  assert.ok(Math.abs(front.coat[0] - 0.5) < 1e-3, 'the coat’s own')
  // Its depth within the transparent passes' bias of the front's: the same surface.
  assert.notDeepEqual(read(z * (1 + 2 ** -19)).base, [7, 7, 7])
  // A surface behind it, a fragment told it is not the front, a texel of another image, an image
  // without a front pass: the chain, with no proxy stage.
  assert.deepEqual(read(z * (1 - 2 ** -12)).base, [7, 7, 7])
  assert.deepEqual(read(z, false).base, [7, 7, 7])
  assert.deepEqual(forward(texel, 10)(z).base, [7, 7, 7])
  assert.deepEqual(forward(texel, 0)(z).base, [7, 7, 7])
})

test('only the trace casts the proxy’s rays: a forward program binds no proxy', () => {
  const forwardText = wgslModule(forwardReflectionWgsl(1, true, 24))
  for (const name of ['rtRadiance', 'rtAnswer', 'rtProxy', 'reflectionProxied'])
    assert.doesNotMatch(forwardText, new RegExp(`\\b${name}\\b`), name)
  assert.match(wgslModule(reflectedRadianceWgsl(1, RUNTIME_BINDINGS)), /\breflectionProxied\b/)
  // The trace writes the front's radiance with the depth and the stamp the fragment matches.
  assert.ok(TRACE_SHADER.includes('textureStore(frontOut,'))
  assert.ok(TRACE_SHADER.includes('reflectionView.runtime.y'))
  // A tile is listed for each surface, and its trace answers that surface's cell.
  assert.ok(TRACE_SHADER.includes('|(layer<<31u)'))
  assert.ok(TRACE_SHADER.includes('rtLayer=tile>>31u;'))
})
