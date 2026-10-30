// The transparents' front layer (`frontLayer.ts`), the shipped WGSL run as JavaScript: a forward fragment
// reads the radiance the trace's accumulation wrote where it is the front surface of this image, one load, and
// the probes' field anywhere else — no program but the trace casts a ray.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { forwardIndirectWgsl } from './forward.ts'
import { reflectionStagesWgsl } from './wgsl.ts'
import { reflectionTraceShader } from './trace/trace.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'

const TRACE_SHADER = reflectionTraceShader(false)

/** The accumulation's packer of a front texel's word (`frontPack`). */
const { frontPack: pack } = shaderRun<{ frontPack: (c: Vec3) => number }>(
  wgslModule(FRONT_PACK_WGSL),
  ['frontPack'],
  {},
)

/** The bits of the float32 `x`: the word of the front's depth in a traced texel. */
const floatBits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]

type Reflected = { base: Vec3; coat: Vec3 }

/** The translucency volume's read, which the forward program lists and these tests do not run. */
const GI_STUB = wgslBlock(
  'GI_STUB',
  [],
  'fn translucentGiIrradiance(P:vec3f,N:vec3f,single:bool)->vec3f{return vec3f(0.0);}\nvar<private> translucentGiSingle:bool=false;',
)

/** `forwardTrace` of the shipped forward program (`forwardIndirectWgsl`), over a front texel `texel`
 *  (its third word the bits of the front depth, `FRONT_TRACED_FORMAT`) at every pixel, `answered` whether this image's trace answered the
 *  front; the field answers `field`. */
function forward(texel: number[], answered = true) {
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
    wgslModule(forwardIndirectWgsl(1, false, 24, GI_STUB)),
    ['forwardTrace', 'frontUnpack', 'reflectionFrontTraced'],
    {
      frontTraced: { load: () => texel },
      reflectionView: { front: [answered ? 1 : 0, 0, 0, 0] },
      reflectionEnvironmentOf: () => ({ base: field, coat: [0, 0, 0] }),
    },
  )
  return (z: number, front = true) =>
    run.forwardTrace([0, 0, 0], [0, 0, 1], [0, 0, 1], 0.1, [3.5, 4.5, z, 1], front)
}

test('a fragment at the front depth reads the trace’s radiance; any other, the environment', () => {
  const z = 0.25
  const texel = [pack([1, 2, 4]), pack([0.5, 0, 0]), floatBits(z), 0]
  const read = forward(texel)
  const front = read(z)
  front.base.forEach((c, k) => assert.ok(Math.abs(c - [1, 2, 4][k]) < 1e-2, `${front.base}`))
  assert.ok(Math.abs(front.coat[0] - 0.5) < 1e-3, 'the coat’s own')
  // Its depth within the transparent passes' bias of the front's: the same surface.
  assert.notDeepEqual(read(z * (1 + 2 ** -19)).base, [7, 7, 7])
  // A surface behind it, a fragment told it is not the front, an image whose trace did not answer the
  // front: the field, no ray.
  assert.deepEqual(read(z * (1 - 2 ** -12)).base, [7, 7, 7])
  assert.deepEqual(read(z, false).base, [7, 7, 7])
  assert.deepEqual(forward(texel, false)(z).base, [7, 7, 7])
})

test('one chain: only the trace marches the field and samples a lobe; a forward program reads its answer', () => {
  const forwardText = wgslModule(forwardIndirectWgsl(1, true, 24, GI_STUB))
  for (const name of [
    'rtRadiance',
    'rtProxy',
    'scSampleMeshCards',
    'gdfTrace',
    'reflectionSceneTrace',
    'reflectionSampleDirection',
  ])
    assert.doesNotMatch(forwardText, new RegExp(`\\b${name}\\b`), name)
  assert.match(wgslModule(reflectionStagesWgsl(1)), /\breflectionSceneTrace\b/)
  // Nor does it give its light a look: the contrast and the specular scale are the opaque composite's alone.
  assert.doesNotMatch(forwardText, /\breflectionLook\b|view\.reflection\b/)
  // The front surface is traced, resolved and accumulated as the opaque one by the same kernels on its own
  // layer (the pipeline's, `createTraceStages`) — a pixel a thread of a listed tile, the scene stage a
  // thread a ray the screen missed —, and its last pass writes its radiance where the forward fragments
  // read it.
  for (const kernel of [
    'override REFLECTION_LAYER:u32=0u;',
    'generateTexel(id,REFLECTION_LAYER);',
    'begun=traceScreenBegin(id,REFLECTION_LAYER);',
    // the scene stage reads of its pixel the ray's origin and its top lobe's normal alone (`reflectingPointAt`)
    'let own=reflectingPointAt(REFLECTION_LAYER,coord);',
    'textureStore(resolvedOut,id,resolvePixel(vec2i(id),REFLECTION_LAYER));',
    'textureStore(historyOut,id,temporalPixel(vec2i(id),local.xy,REFLECTION_LAYER));',
    'let own=reflectingPixelAt(1u,coord,flags);',
  ])
    assert.ok(TRACE_SHADER.includes(kernel), kernel)
  assert.ok(TRACE_SHADER.includes('textureStore(frontOut,coord,'))
})
