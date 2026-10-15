// The transparents' front layer (`frontLayer.ts`), the shipped WGSL run as JavaScript: a forward fragment
// reads the radiance the trace's upsample wrote where it is the front surface of this image, one load, and
// the chain without the proxy anywhere else — no program but the trace casts a ray of the proxy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import type { Vec } from '../bounce/runtimeOracle.fixture.ts'
import { forwardReflectionWgsl } from './weight.ts'
import { reflectedRadianceWgsl } from './wgsl.ts'
import { TRACE_SCENE_BINDINGS } from './halfBindings.ts'
import { REFLECTION_TRACE_SHADER } from './traceHalf.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'

/** The upsample's packer of a front texel's word (`frontPack`). */
const { frontPack: pack } = shaderRun<{ frontPack: (c: Vec) => number }>(
  wgslModule(FRONT_PACK_WGSL),
  ['frontPack'],
  {},
)

type Reflected = { base: Vec; coat: Vec }

/** `forwardTrace` of the shipped forward program, over a front texel `texel` and a front depth `depth` at
 *  every pixel, `answered` whether this image's trace answered the front; the chain without the proxy
 *  answers `chain`. */
function forward(texel: number[], depth: number, answered = true) {
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
  }>(
    wgslModule(forwardReflectionWgsl(1, false, 24)),
    ['forwardTrace', 'frontUnpack', 'reflectionFrontTraced', 'reflectionFrontDepth'],
    {
      frontTraced: { load: () => texel },
      reflectionFront: { load: () => [depth, 0, 0, 0] },
      reflectionView: { front: [answered ? 1 : 0, 0, 0, 0] },
      reflectionTrace: () => chain,
    },
  )
  return (z: number, front = true) =>
    run.forwardTrace([0, 0, 0], [0, 0, 1], [0, 0, 1], 0.1, [3.5, 4.5, z, 1], front)
}

test('a fragment at the front depth reads the trace’s radiance; any other, the chain', () => {
  const z = 0.25
  const texel = [pack([1, 2, 4]), pack([0.5, 0, 0]), 0, 0]
  const read = forward(texel, z)
  const front = read(z)
  front.base.forEach((c, k) => assert.ok(Math.abs(c - [1, 2, 4][k]) < 1e-2, `${front.base}`))
  assert.ok(Math.abs(front.coat[0] - 0.5) < 1e-3, 'the coat’s own')
  // Its depth within the transparent passes' bias of the front's: the same surface.
  assert.notDeepEqual(read(z * (1 + 2 ** -19)).base, [7, 7, 7])
  // A surface behind it, a fragment told it is not the front, an image whose trace did not answer the
  // front: the chain, with no proxy stage.
  assert.deepEqual(read(z * (1 - 2 ** -12)).base, [7, 7, 7])
  assert.deepEqual(read(z, false).base, [7, 7, 7])
  assert.deepEqual(forward(texel, z, false)(z).base, [7, 7, 7])
})

test('only the trace casts the proxy’s rays: a forward program binds no proxy', () => {
  const forwardText = wgslModule(forwardReflectionWgsl(1, true, 24))
  for (const name of ['rtRadiance', 'rtProxy', 'reflectionProxied'])
    assert.doesNotMatch(forwardText, new RegExp(`\\b${name}\\b`), name)
  assert.match(wgslModule(reflectedRadianceWgsl(1, TRACE_SCENE_BINDINGS)), /\breflectionProxied\b/)
  // The front surface is traced, accumulated and upsampled as the opaque one, by the same kernels on
  // its own layer (the pipeline's, `createTraceStages`), and the upsample writes its radiance where the
  // forward fragments read it.
  for (const kernel of [
    'override REFLECTION_LAYER:u32;',
    'let fresh=traceTexel(id.xy,REFLECTION_LAYER);',
    'textureStore(historyOut,id.xy,temporalTexel(vec2i(id.xy),REFLECTION_LAYER));',
    'reflectedAt(1u,coord,reflectingPixelAt(1u,coord,flags))',
  ])
    assert.ok(REFLECTION_TRACE_SHADER.includes(kernel), kernel)
  assert.ok(REFLECTION_TRACE_SHADER.includes('textureStore(frontOut,coord,'))
})
