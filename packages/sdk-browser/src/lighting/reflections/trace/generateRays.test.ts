// The reflections' ray generation (`generateRays`, `trace.ts`), shipped WGSL run as JavaScript (`shaderRun`): what a grid texel keeps for the
// pixel of its block it casts from, a ray and its depth or no ray and a negated depth, and the order of the passes that make and read it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { REFLECTION_CONSTANTS } from '../constants.ts'
import { reflectionTraceShader } from './trace.ts'
import { KERNELS } from './traceGroups.ts'

const PROGRAM = reflectionTraceShader(false)

type Store = { at: number[]; layer: number; value: number[] }
type Run = {
  generateTexel: (g: number[], layer: number) => void
  reflectionRayOf: (direction: number, cone: number) => number[]
  reflectionRayTraces: (depth: number) => boolean
}

/** The ray generation of a texel whose picked pixel is `(5, 6)`, over the answers the test gives the pixel: the stores it makes, in order. */
function generate(pixel: { reflects: boolean; traces: boolean; firstPerson?: boolean }) {
  const stores: Store[] = []
  const picked: number[][] = []
  const run = shaderRun<Run>(PROGRAM, ['generateTexel', 'reflectionRayOf', 'reflectionRayTraces'], {
    surfaceRays: undefined,
    reflectionPickedPixel: (g: number[]) => {
      picked.push(g)
      return [5, 6]
    },
    surfaceFlagsAt: () => (pixel.firstPerson ? 1 : 0),
    surfaceReflects: () => pixel.reflects,
    reflectionPixelTraces: () => pixel.traces,
    reflectingPixelAt: (_: number, __: number[], flags: number) => ({ z: 0.25, flags }),
    reflectionSampleAt: () => [0.5, 0.5],
    reflectionCastRay: () => ({ R: [0.6, 0, 0.8] }),
    reflectionCastCone: () => 0.5,
    isFirstPerson: (flags: number) => flags === 1,
    surfaceDepthAt: () => 0.75,
    textureStore: (_: unknown, at: number[], layer: number, value: number[]) =>
      stores.push({ at, layer, value }),
  })
  run.generateTexel([2, 3], 0)
  return { stores, picked, run }
}

const floatOf = (bits: number) => new Float32Array(new Uint32Array([bits]).buffer)[0]

test('a texel whose picked pixel traces keeps its ray, direction and cone angle in half floats, and the depth of the pixel', () => {
  const { stores, picked, run } = generate({ reflects: true, traces: true })
  assert.deepEqual(picked, [[2, 3]], 'the pixel is the texel’s pick')
  assert.deepEqual(
    stores.map(({ at, layer }) => [at, layer]),
    [
      [[2, 3], 1],
      [[2, 3], 2],
      [[2, 3], 0],
    ],
    'the direction, the third half with the cone angle, the depth',
  )
  const ray = run.reflectionRayOf(stores[0].value[0], stores[1].value[0])
  for (const [got, want] of [
    [ray[0], 0.6],
    [ray[1], 0],
    [ray[2], 0.8],
    [ray[3], 0.5],
  ])
    assert.ok(Math.abs(got - want) < 1e-3, `${got} is ${want}`)
  assert.equal(floatOf(stores[2].value[0]), 0.25, 'the depth of the pixel the ray leaves')
  assert.ok(run.reflectionRayTraces(floatOf(stores[2].value[0])))
})

test('the sign of the cone angle tells a pixel of a first-person object, and the ray’s pdf, its inverse, ignores it', () => {
  const plain = generate({ reflects: true, traces: true })
  const mine = generate({ reflects: true, traces: true, firstPerson: true })
  assert.equal(plain.run.reflectionRayOf(0, plain.stores[1].value[0])[3], 0.5)
  assert.equal(mine.run.reflectionRayOf(0, mine.stores[1].value[0])[3], -0.5)
  assert.equal(mine.stores[0].value[0], plain.stores[0].value[0], 'the direction is the same')
})

test('a texel whose picked pixel casts none keeps the negated depth of the pixel and no ray; a depth that is not positive is no ray', () => {
  for (const pixel of [
    { reflects: true, traces: false },
    { reflects: false, traces: true },
  ]) {
    const { stores, run } = generate(pixel)
    assert.equal(stores.length, 1)
    assert.deepEqual([stores[0].at, stores[0].layer], [[2, 3], 0])
    assert.equal(floatOf(stores[0].value[0]), -0.75)
    assert.equal(run.reflectionRayTraces(floatOf(stores[0].value[0])), false)
  }
  const { run } = generate({ reflects: true, traces: true })
  assert.equal(run.reflectionRayTraces(0), false, 'a pixel at no depth casts none')
  assert.equal(run.reflectionRayTraces(-0), false)
})

test('the clear of an unused tracing tile leaves the depth negative, as the reference clears its downsampled depth, and the least cone angle is the reference’s', () => {
  assert.ok(PROGRAM.includes('const REFLECTION_NO_RAY_DEPTH:f32=-1.0;'))
  assert.ok(
    PROGRAM.includes(
      'textureStore(surfaceRays,vec2i(g),REFLECTION_RAY_DEPTH,vec4u(bitcast<u32>(REFLECTION_NO_RAY_DEPTH),0u,0u,0u));',
    ),
  )
  assert.equal(REFLECTION_CONSTANTS.REFLECTION_MIN_CONE, 0.00001)
})

test('the ray generation is a kernel of its own over the tracing tiles, and it alone draws a ray: the stages read the stored one', () => {
  assert.ok(PROGRAM.includes('fn generateRays('))
  assert.ok(KERNELS.indexOf('generate') < KERNELS.indexOf('screen'))
  // The direction is drawn at one place: the declaration and one call.
  assert.equal([...PROGRAM.matchAll(/reflectionCastRay\(/g)].length, 2)
  assert.ok(PROGRAM.includes('let ray=reflectionCastRay(own,reflectionSampleAt(g));'))
  assert.ok(
    PROGRAM.includes(
      'reflectionScreenEnd(begun.own.P,begun.own.topN,begun.stored.ray,begun.aimed,marched,g)',
    ),
  )
})
