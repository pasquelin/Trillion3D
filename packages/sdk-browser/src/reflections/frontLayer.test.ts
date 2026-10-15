// The transparents' front layer (`frontLayer.ts`), the shipped WGSL run as JavaScript: a forward fragment
// reads the radiance the trace's accumulation wrote where it is the front surface of this image, one load, and
// the probes' field anywhere else — no program but the trace casts a ray.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { forwardReflectionWgsl } from './weight.ts'
import { reflectionStagesWgsl } from './wgsl.ts'
import { REFLECTION_TRACE_SHADER } from './trace.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import type { Vec3 } from '../../../math/src/vector/vectorTuple.ts'

/** The accumulation's packer of a front texel's word (`frontPack`). */
const { frontPack: pack } = shaderRun<{ frontPack: (c: Vec3) => number }>(
  wgslModule(FRONT_PACK_WGSL),
  ['frontPack'],
  {},
)

type Reflected = { base: Vec3; coat: Vec3 }

/** `forwardTrace` of the shipped forward program, over a front texel `texel` and a front depth `depth` at
 *  every pixel, `answered` whether this image's trace answered the front; the field answers `field`. */
function forward(texel: number[], depth: number, answered = true) {
  const field: Vec3 = [7, 7, 7]
  const run = shaderRun<{
    forwardTrace: (
      P: Vec3,
      N: Vec3,
      V: Vec3,
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
      reflectionField: () => field,
    },
  )
  return (z: number, front = true) =>
    run.forwardTrace([0, 0, 0], [0, 0, 1], [0, 0, 1], 0.1, [3.5, 4.5, z, 1], front)
}

test('a fragment at the front depth reads the trace’s radiance; any other, the field', () => {
  const z = 0.25
  const texel = [pack([1, 2, 4]), pack([0.5, 0, 0]), 0, 0]
  const read = forward(texel, z)
  const front = read(z)
  front.base.forEach((c, k) => assert.ok(Math.abs(c - [1, 2, 4][k]) < 1e-2, `${front.base}`))
  assert.ok(Math.abs(front.coat[0] - 0.5) < 1e-3, 'the coat’s own')
  // Its depth within the transparent passes' bias of the front's: the same surface.
  assert.notDeepEqual(read(z * (1 + 2 ** -19)).base, [7, 7, 7])
  // A surface behind it, a fragment told it is not the front, an image whose trace did not answer the
  // front: the field, no ray.
  assert.deepEqual(read(z * (1 - 2 ** -12)).base, [7, 7, 7])
  assert.deepEqual(read(z, false).base, [7, 7, 7])
  assert.deepEqual(forward(texel, z, false)(z).base, [7, 7, 7])
})

test('one chain: only the trace walks the proxy and samples a lobe; a forward program reads its answer', () => {
  const forwardText = wgslModule(forwardReflectionWgsl(1, true, 24))
  for (const name of ['rtRadiance', 'rtProxy', 'reflectionProxied', 'reflectionSampleDirection'])
    assert.doesNotMatch(forwardText, new RegExp(`\\b${name}\\b`), name)
  assert.match(wgslModule(reflectionStagesWgsl(1)), /\breflectionProxied\b/)
  // The front surface is traced, reused and accumulated as the opaque one by the same kernels on its own
  // layer (the pipeline's, `createTraceStages`) — a pixel a thread of a listed tile, the scene stage a
  // thread a ray the screen left —, and its last pass writes its radiance where the forward fragments
  // read it.
  for (const kernel of [
    'override REFLECTION_LAYER:u32;',
    'left=traceScreenTexel(id,REFLECTION_LAYER);',
    'let own=reflectingPixelAt(REFLECTION_LAYER,coord,surfaceFlagsAt(coord));',
    'textureStore(spatialOut,id,spatialTexel(vec2i(id),REFLECTION_LAYER));',
    'textureStore(historyOut,id,temporalTexel(vec2i(id),REFLECTION_LAYER));',
    'let r=bilateralTexel(coord,reflectingPixelAt(1u,coord,flags));',
  ])
    assert.ok(REFLECTION_TRACE_SHADER.includes(kernel), kernel)
  assert.ok(REFLECTION_TRACE_SHADER.includes('textureStore(frontOut,coord,'))
})
