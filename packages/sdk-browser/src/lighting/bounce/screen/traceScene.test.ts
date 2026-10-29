// The scene stage's answer to a ray the screen left (`spSceneRay`, `traceSceneWgsl.ts`), the shipped WGSL run as JavaScript (`shaderRun`) with
// the march and the radiance cache standing in as each test says: the ray is marched through the field first, the cache read only for what
// the march leaves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { fogLights } from '../../reflections/sceneTrace.fixture.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import { traceSceneEntries, traceSceneShader } from './traceSceneWgsl.ts'

/** What the march was asked, call by call. */
type March = { begin: number; reach: number; coord: number[]; side: number }

/** The height fog laid over the rays: the `light.w` of the reflections' view, the length the sky is fogged over at least, and where the fog was asked, `reflectionFogged` standing in as
 *  a halving of the light that notes where it was seen from and along what. */
type Fog = { lightW: number; seen: { from: Vec3; along: Vec3 }[] }

/** The scope `spFogged` stands in (`reflectionFogged`) for a program with the fog on. */
const fogScope = ({ lightW, seen }: Fog) => ({
  reflectionView: { light: [0, 0, 0, lightW] },
  reflectionFogged: (rgb: Vec3, from: Vec3, along: Vec3) => (
    seen.push({ from, along }),
    rgb.map((c) => c * 0.5)
  ),
})

/**
 * `spSceneRay` of a probe moving at `speed` whose ray the screen left at `missed` metres, the probe's reach 20 m, where the march
 * `hits` (its light `[1, 2, 3]`) or leaves the ray, the radiance cache giving the light `[4, 5, 6]` at 12 metres (its `stored` end the ray's word keeps), with the scene
 * traces `on` or not, the height fog laid over its light where `fog` says. A `pose` says a pose moved since the last drawn frame (`SP_FLAG_POSES_MOVING`) and that the object `instance` that lit the hit went `speed` metres
 * (what `stHitVelocity` answers, asked with the hit's point from the eye, recorded in `asked`); none, the hit names no object and no pose moved.
 */
function sceneRay(
  hits: boolean,
  missed = 0.5,
  on = true,
  speed = 0,
  leak = 0,
  stored = 12,
  fog?: Fog,
  pose?: { instance: number; speed: number },
) {
  const asked: unknown[][] = []
  const marches: March[] = []
  const far: Vec3[] = []
  const { spSceneRay } = shaderRun<{
    spSceneRay: (
      probe: object,
      d: Vec3,
      missed: number,
      coord: number[],
      side: number,
    ) => { radiance: Vec3; word: number[] }
  }>(traceSceneShader(8, [4, 4], !!fog), ['spSceneRay'], {
    sp: {
      motion: [0.005, 0, 0, 0.0001],
      scene: [0.05, 0.01],
      eyeXY: [1, 2, 3, 4],
      eyeZ: [5, 6, 0, 0],
    },
    view: { display: [0, 1, 2, 3] },
    SP_FLAG_SCENE_TRACES: 1,
    SP_FLAG_POSES_MOVING: 2,
    spFlag: (bit: number) => (bit === 1 && on) || (bit === 2 && !!pose),
    stHitVelocity: (...args: unknown[]) => (asked.push(args), [pose!.speed, 0, 0]),
    spLocalReach: () => 20,
    spMarch: (_: object, __: Vec3, begin: number, reach: number, coord: number[], side: number) => {
      marches.push({ begin, reach, coord, side })
      return {
        lighting: hits ? [1, 2, 3] : [0, 0, 0],
        hit: hits,
        distance: hits ? 7 : 0,
        point: [8, 1, 1],
        instance: hits && pose ? pose.instance : 0xffffffff,
      }
    },
    spFarOf: (point: Vec3) => (far.push(point), { radiance: [4, 5, 6], distance: 12, stored }),
    spHitWord: (distance: number, moving: boolean) => [distance, moving],
    // The sky light that leaks onto what the ray found: `leak` a metre of the way to where it leaks whole, none by default.
    spSkyLeak: (_: Vec3, distance: number) => [leak * distance, leak * distance, leak * distance],
    ...(fog && fogScope(fog)),
  })
  const probe = { P: [1, 1, 1], depth: 10, N: [0, 1, 0], speed }
  const ray = spSceneRay(probe, [1, 0, 0], missed, [3, 4], 8)
  return { ray, marches, far, asked }
}

test('a ray the march hits answers the light of its hit and the reach it was marched to as its end, and reads the radiance cache for none of it', () => {
  const { ray, marches, far } = sceneRay(true)
  assert.deepEqual(ray.radiance, [1, 2, 3])
  assert.deepEqual(
    ray.word,
    [20, false],
    'the end is the reach of the probe’s cell, not the hit’s 7 metres',
  )
  assert.equal(marches.length, 1)
  assert.deepEqual(far, [], 'the cache is read only for the rays the march left')
})

test('a ray the march leaves answers the radiance cache’s light and distance', () => {
  const { ray, far } = sceneRay(false)
  assert.deepEqual(ray.radiance, [4, 5, 6])
  assert.deepEqual(ray.word, [12, false])
  assert.deepEqual(far, [[1, 1, 1]])
})

test('a ray the cache answers keeps in its word the end the cache names for it, the sky light that leaks onto it weighed at the distance the cache reads', () => {
  const { ray } = sceneRay(false, 0.5, true, 0, 0.5, 200)
  assert.deepEqual(ray.word, [200, false])
  assert.deepEqual(ray.radiance, [10, 11, 12])
})

test('the sky light that leaks onto what the ray found joins its light, at the distance of the hit or of the radiance cache’s answer', () => {
  assert.deepEqual(
    sceneRay(true, 0.5, true, 0, 0.5).ray.radiance,
    [4.5, 5.5, 6.5],
    'a hit at 7 metres',
  )
  assert.deepEqual(
    sceneRay(false, 0.5, true, 0, 0.5).ray.radiance,
    [10, 11, 12],
    'the cache at 12 metres',
  )
})

test('the march runs from two biases back of where the screen left the ray, no nearer than the least trace, to the reach of the probe’s cell', () => {
  const { marches } = sceneRay(false, 0.5)
  assert.deepEqual(marches[0], { begin: 0.4, reach: 20, coord: [3, 4], side: 8 })
  assert.equal(
    sceneRay(false, 0.05).marches[0].begin,
    0.0001,
    'a ray lost at the surface starts at the least trace',
  )
})

test('a ray the field hits that names no placement, or where no pose moved, is not moving, whatever the probe’s speed, nor one the cache answers; with the scene traces off nothing is marched and the cache answers the whole ray', () => {
  assert.deepEqual(sceneRay(true, 0.5, true, 1).ray.word, [20, false], 'a probe moving fast')
  assert.deepEqual(sceneRay(true, 0.5, true, 0.01).ray.word, [20, false], 'a probe moving slowly')
  assert.deepEqual(
    sceneRay(true, 0.5, true, 1, 0, 12, undefined, { instance: 0xffffffff, speed: 9 }).ray.word,
    [20, false],
    'no object lit the hit',
  )
  assert.deepEqual(
    sceneRay(false, 0.5, true, 1).ray.word,
    [12, false],
    'the cache’s answer is not marked',
  )
  const off = sceneRay(true, 0.5, false)
  assert.deepEqual(off.marches, [])
  assert.deepEqual(
    [off.ray.radiance, off.ray.word],
    [
      [4, 5, 6],
      [12, false],
    ],
  )
})

test('the radiance both entries write is dithered into the 11-11-10 word by the noise of the trace texel at the frame, as a float target quantises it', () => {
  const program = traceSceneShader(8, [4, 4], false)
  assert.match(
    program,
    /fn spTraceLight\(light:vec3f,texel:vec2i\)->u32\{\n return packLight\(ditherLight\(light,spTargetDither\(vec2u\(texel\),0\)\)\);\n\}/,
  )
  const near = program.slice(program.indexOf('fn traceScene('), program.indexOf('fn traceFar('))
  const far = program.slice(program.indexOf('fn traceFar('))
  assert.match(
    near,
    /textureStore\(radianceOut,texel,vec4u\(spTraceLight\(scene\.radiance,texel\),0u,0u,0u\)\)/,
  )
  assert.match(
    far,
    /textureStore\(radianceOut,texel,vec4u\(spTraceLight\(spRayLit\(far\.radiance,ray\.probe,direction,far\.distance,false\),texel\),0u,0u,0u\)\)/,
  )
  // Both entries light a ray the same way, the sky light that leaks onto it joining its light before the one dither.
  assert.match(program, /let light=radiance\+spSkyLeak\(d,end\);/)
  assert.doesNotMatch(near + far, /vec4u\(packLight\(/)
})

test('the height fog is laid over a march hit from the probe’s own point over the distance the march hit at, not the reach its word keeps', () => {
  const fog: Fog = { lightW: 1000, seen: [] }
  const { ray } = sceneRay(true, 0.5, true, 0, 0, 12, fog)
  assert.deepEqual(fog.seen, [{ from: [1, 1, 1], along: [7, 0, 0] }])
  assert.deepEqual(ray.radiance, [0.5, 1, 1.5], 'the fogged light is the one written')
  assert.deepEqual(ray.word, [20, false], 'and the word still keeps the reach')
})

test('the height fog is laid over what the radiance cache or the sky answers from the probe’s own point over its distance or the sky’s length, the longer, after the sky light that leaks onto it', () => {
  const near: Fog = { lightW: 5, seen: [] }
  const far: Fog = { lightW: 1000, seen: [] }
  assert.deepEqual(sceneRay(false, 0.5, true, 0, 0, 12, near).ray.radiance, [2, 2.5, 3])
  assert.deepEqual(near.seen, [{ from: [1, 1, 1], along: [12, 0, 0] }], 'the cache’s 12 metres')
  sceneRay(false, 0.5, true, 0, 0.5, 12, far)
  assert.deepEqual(far.seen, [{ from: [1, 1, 1], along: [1000, 0, 0] }], 'the sky’s length')
  // The light that is fogged holds the leak: 4, 5 and 6 and, at the cache’s 12 metres, 6 more, halved.
  const leak: Fog = { lightW: 5, seen: [] }
  assert.deepEqual(sceneRay(false, 0.5, true, 0, 0.5, 12, leak).ray.radiance, [5, 5.5, 6])
})

test('the radiance cache’s answer to a ray the traced stage left (traceFar) is fogged as the march’s, from the probe’s own point', () => {
  const fog: Fog = { lightW: 5, seen: [] }
  const { spRayLit } = shaderRun<{
    spRayLit: (light: Vec3, probe: object, d: Vec3, end: number, hit: boolean) => Vec3
  }>(traceSceneShader(8, [4, 4], true), ['spRayLit'], {
    spSkyLeak: () => [1, 1, 1],
    ...fogScope(fog),
  })
  const probe = { P: [2, 3, 4], depth: 10, N: [0, 1, 0], speed: 0, foliage: false, hair: false }
  assert.deepEqual(spRayLit([1, 2, 3], probe, [0, 1, 0], 12, false), [1, 1.5, 2])
  assert.deepEqual(fog.seen, [{ from: [2, 3, 4], along: [0, 12, 0] }])
  spRayLit([1, 2, 3], probe, [0, 1, 0], 2, false)
  assert.deepEqual(
    fog.seen[1].along,
    [0, 5, 0],
    'a cache answer nearer than the sky’s length is fogged over the length',
  )
  spRayLit([1, 2, 3], probe, [0, 1, 0], 2, true)
  assert.deepEqual(fog.seen[2].along, [0, 2, 0], 'a hit is fogged over the distance it hit at')
})

test('where the scene has no fog the light is left as it was; where the option is off the program holds no fog code at all', () => {
  const { spRayLit } = shaderRun<{
    spRayLit: (light: Vec3, probe: object, d: Vec3, end: number, hit: boolean) => Vec3
  }>(traceSceneShader(8, [4, 4], true), ['spRayLit'], {
    spSkyLeak: () => [0, 0, 0],
    reflectionView: { light: [0, 0, 0, 1000] },
    directLights: fogLights(undefined),
    reflectionDone: () => true,
  })
  const probe = { P: [2, 3, 4], depth: 10, N: [0, 1, 0], speed: 0, foliage: false, hair: false }
  assert.deepEqual(spRayLit([1, 2, 3], probe, [0, 1, 0], 12, false), [1, 2, 3])
  const off = traceSceneShader(8, [4, 4], false)
  assert.doesNotMatch(off, /reflectionFogged|spRayFogged/)
  assert.match(traceSceneShader(8, [4, 4], true), /reflectionFogged/)
  assert.equal(
    traceSceneEntries(true).length,
    traceSceneEntries(false).length + 2,
    'the fog’s two reads are bound only where it is on',
  )
})

test('a ray the field hits takes the speed of the placement that lit it: moving when the probe’s speed and the placement’s differ by more than the share of the probe’s depth, asked at the hit’s point from the eye', () => {
  const still = sceneRay(true, 0.5, true, 0, 0, 12, undefined, { instance: 3, speed: 0 })
  assert.deepEqual(still.ray.word, [20, false], 'a placement that did not move, on a still probe')
  assert.deepEqual(JSON.parse(JSON.stringify(still.asked)), [
    [3, [7, -1, -2], [1, 2, 3, 4], [5, 6, 0, 0]],
  ])
  const moved = sceneRay(true, 0.5, true, 0, 0, 12, undefined, { instance: 3, speed: 0.2 })
  assert.deepEqual(moved.ray.word, [20, true], '0.2 m over a depth of 10 m is past 0.005')
  const alike = sceneRay(true, 0.5, true, 0.2, 0, 12, undefined, { instance: 3, speed: 0.2 })
  assert.deepEqual(alike.ray.word, [20, false], 'a probe on the placement goes as it goes')
  assert.deepEqual(
    sceneRay(false, 0.5, true, 0, 0, 12, undefined, { instance: 3, speed: 0.2 }).ray.word,
    [12, false],
    'the cache’s answer is not marked',
  )
})
