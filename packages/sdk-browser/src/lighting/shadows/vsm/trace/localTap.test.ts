// A local light's one tap (`vsmLocalTap`, `traceTapWgsl.ts`), the reference's one
// `SampleVirtualShadowMapLocal`: the stored depth of the texel the receiver falls on, lowered by the
// ray start and, with the optimal bias, by the receiver plane's lift to the texel's centre, against
// the receiver's own; the mip from the receiver's footprint where a scene depth is given.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { vsmSunsProjectionWgsl } from '../projection/projectionWgsl.ts'
import { vsmLayout } from '../layout.ts'

const CODE = vsmSunsProjectionWgsl(
  vsmLayout({ coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 35 }),
)
const K = wgslConstants(CODE)
/** A perspective map: depth −0.5 a unit of view depth (`lightViewToClip[2][2]`). */
const CLIP = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -0.5, 0, 0, 0, -0.1, 1])

/** The tap over a map whose stored depth is 0.6 at a texel centred a quarter texel off the receiver's
 *  position, the receiver at clip depth 0.2 (`mapPoint` w 2), reading mip `read` of the pages; the mips
 *  asked of the map and of the receiver's footprint are told. */
function tap(slope: number[]) {
  const asked: { read: number[]; footprint: number[] } = { read: [], footprint: [] }
  const run = shaderRun<{
    vsmLocalTap(...a: unknown[]): {
      shadowFactor: number
      rayCount: number
      occluderDistance: number
    }
  }>(CODE, ['vsmLocalTap'], {
    ...K,
    vsmView: { viewToClip: CLIP, viewPixels: [1920, 1080, 0, 0] },
    vsmProjectionOf: () => ({ finestMip: 2, lightViewToClip: CLIP }),
    vsmLocalMipAt: (_pd: unknown, _p: unknown, depth: number) => (asked.footprint.push(depth), 5),
    vsmReadMap: (_h: unknown, _uv: number[], mip: number) => (
      asked.read.push(mip),
      { valid: true, depth: 0.6, mapTexelXY: [0, 0], mapTexelPos: [0.25, 0.75], mipLevel: 3 }
    ),
    vsmDepthGradientUv: () => slope,
  })
  const m = { handle: { id: 0 }, mapPoint: [0.5, 0.5, 0.4, 2], pInMap: [3, 0, 4] }
  return { run, m, asked }
}

test('the tap is lit where the stored depth, lowered by the ray start, does not pass the receiver', () => {
  const { run, m } = tap([0, 0])
  const at = (start: number) => run.vsmLocalTap(m, start, [0, 0, 1], false, -1)
  // The stored depth 0.6 lies nearer the light than the receiver at 0.2: in shadow, a ray count of one.
  const shadowed = at(0)
  assert.deepEqual([shadowed.shadowFactor, shadowed.rayCount], [0, 1])
  assert.ok(shadowed.occluderDistance > 0, 'how far the occluder lies')
  // A ray start of 2 lifts the receiver 2 · 0.5 / 2 = 0.5 in depth: 0.6 − 0.5 = 0.1, behind the receiver.
  assert.equal(at(2).shadowFactor, 1)
  assert.equal(at(-2).shadowFactor, 0, 'a negative start is none')
})

test('the optimal bias lowers the stored depth by the plane’s lift to the texel centre, held to a cap', () => {
  const lit = (slope: number[], optimal: boolean) => {
    const { run, m } = tap(slope)
    return run.vsmLocalTap(m, 0, [0, 0, 1], optimal, -1).shadowFactor
  }
  // The centre lies a quarter texel right of the receiver in X, 2048 texels a side at mip 3: the lift
  // is 2 · slope · 0.25 / 2048, 0.244 for a slope of 1000, 0.488 for 4000.
  assert.equal(lit([1000, 0], true), 0, '0.244: the depth 0.6 − 0.244 still passes 0.2')
  assert.equal(lit([4000, 0], true), 1, '0.488: the depth falls behind the receiver')
  assert.equal(lit([4000, 0], false), 0, 'no optimal bias: the plane is not asked')
  assert.equal(lit([-4000, 0], true), 0, 'a plane that falls toward the light lifts nothing')
})

test('the mip is the finest of the map without a scene depth, the receiver’s footprint with one', () => {
  const { run, m, asked } = tap([0, 0])
  run.vsmLocalTap(m, 0, [0, 0, 1], false, -1)
  assert.deepEqual([asked.read, asked.footprint], [[2], []], 'the finest, 2')
  run.vsmLocalTap(m, 0, [0, 0, 1], false, 30)
  assert.deepEqual([asked.read, asked.footprint], [[2, 5], [30]], 'the footprint’s, at its depth')
})

test('a receiver no page maps is lit and traces no ray', () => {
  const run = shaderRun<{
    vsmLocalTap(...a: unknown[]): { shadowFactor: number; rayCount: number }
  }>(CODE, ['vsmLocalTap'], {
    ...K,
    vsmView: { viewToClip: CLIP, viewPixels: [1920, 1080, 0, 0] },
    vsmProjectionOf: () => ({ finestMip: 0, lightViewToClip: CLIP }),
    vsmReadMap: () => ({ valid: false }),
  })
  const m = { handle: { id: 0 }, mapPoint: [0.5, 0.5, 0.4, 2], pInMap: [3, 0, 4] }
  const none = run.vsmLocalTap(m, 0, [0, 0, 1], true, -1)
  assert.deepEqual([none.shadowFactor, none.rayCount], [1, 0])
})
