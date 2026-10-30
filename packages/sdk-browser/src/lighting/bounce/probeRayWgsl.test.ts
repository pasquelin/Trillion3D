// The ray of a world probe (`probeRay`, `probeRayWgsl.ts`), the shipped WGSL run as JavaScript (`shaderRun`) with the march and the cache's
// read standing in as each test says: what the ray asks of the field, and what it answers where it meets a surface and where it leaves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { surfaceHitBindingsFrom } from '../surfaceCache/hitWgsl.ts'
import { probeRayWgsl } from './probeRayWgsl.ts'
import type { ProbeRayModule } from './probeRay.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

/** `probeRay` from `origin` along +x, over `[begin, 20]` metres, where the march meets a surface at `hitTime` centimetres from the origin
 *  (`-1`: none) after `steps`; the image's frame 13. What the march and the hit's read were asked is returned beside the answer. */
function ray(hitTime: number, begin = 0, steps = 9, clipmaps = 4) {
  const asked: { input?: Record<string, unknown>; hit?: unknown[] } = {}
  const { probeRay } = shaderRun<ProbeRayModule>(
    wgslModule(probeRayWgsl(surfaceHitBindingsFrom(0, 0), WORD_LIGHT_FORMAT, false)),
    ['probeRay'],
    {
      gdfView: { clipmaps },
      bounce: { frame: [0, 0, 13, 0] },
      gdfTraceRay: (
        start: Vec3,
        dir: Vec3,
        minTrace: number,
        maxTrace: number,
        stepFactor: number,
        expandByTime: boolean,
        dithered: boolean,
        ditherCoord: number[],
        turn: number,
      ) => {
        asked.input = {
          start,
          dir,
          minTrace,
          maxTrace,
          stepFactor,
          expandByTime,
          dithered,
          ditherCoord,
          turn,
        }
        return { hitTime, clipmap: 1, steps, expand: 0 }
      },
      scGlobalHit: (...args: unknown[]) => ((asked.hit = args), { radiance: [1, 2, 3] }),
    },
  )
  return { answer: probeRay([1, 2, 3], [1, 0, 0], begin, 20, 4, [5, 6]), asked }
}

test('a ray that meets a surface answers its light, its distance in metres and the steps of its march, the surface facing it and one-sided: the field has no back', () => {
  const { answer } = ray(250)
  assert.deepEqual(answer, {
    lighting: [1, 2, 3],
    open: 0,
    distance: 2.5,
    steps: 9,
    front: true,
    twoSided: false,
  })
})

test('a ray that meets none leaves the scene: no light, open, the whole reach', () => {
  assert.deepEqual(ray(-1).answer, {
    lighting: [0, 0, 0],
    open: 1,
    distance: 20,
    steps: 9,
    front: true,
    twoSided: false,
  })
  // No field, or nothing to march: the same, no march.
  assert.deepEqual(ray(250, 0, 9, 0).answer, {
    lighting: [0, 0, 0],
    open: 1,
    distance: 20,
    steps: 0,
    front: true,
    twoSided: false,
  })
  assert.equal(ray(250, 20).asked.input, undefined)
})

test('the march is in centimetres, expanded by the largest distance read, dithered by the texel and the image’s turn', () => {
  const { asked } = ray(250, 0.3)
  assert.deepEqual(
    [asked.input?.start, asked.input?.minTrace, asked.input?.maxTrace],
    [[100, 200, 300], 30, 2000],
  )
  assert.deepEqual(
    [asked.input?.expandByTime, asked.input?.dithered, asked.input?.ditherCoord, asked.input?.turn],
    [false, true, [5, 6], 5],
  )
})

test('the hit’s light is read from the ray’s start, the ray not fading, a hit at or before the least trace one from inside a surface, over the cone of a ray of its side', () => {
  const { asked } = ray(250, 0.3)
  const [origin, dir, , spread, fade, startedInside] = asked.hit as [
    Vec3,
    Vec3,
    object,
    number,
    boolean,
    number,
  ]
  assert.deepEqual([origin, dir, fade, startedInside], [[100, 200, 300], [1, 0, 0], false, 30])
  assert.ok(Math.abs(spread - Math.sqrt(1 - (15 / 16) ** 2) / (15 / 16)) < 1e-6, 'acos(1 - 1/16)')
})
