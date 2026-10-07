import test from 'node:test'
import assert from 'node:assert/strict'
import { FACING_DROP, FACING_WGSL } from './facing.ts'
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts'
import { waterSurfaceWgsl } from '../water/surfaceWgsl.ts'
import { BLEND_SHADER } from '../../gpu/core/shaderTexts.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

type Corner = readonly [x: number, y: number, z: number, w: number]
type Triangle = readonly [Corner, Corner, Corner]

const IDENTITY = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
/** What the shipped functions read: the triangle's clip-space corners as its page positions, the
 *  world and the view-projection the identity, and the target's size in pixels. */
const drawn = { triangle: [] as unknown as Triangle, viewport: [0, 0] }
const shipped = shaderRun<{
  vertexFacing: (cull: number, world: Mat, page: 0, h: 0, corners: number[]) => number
  facingDiscarded: (mode: number, front: boolean) => boolean
}>(FACING_WGSL, ['vertexFacing', 'facingDiscarded', 'perspectiveDivide'], {
  uni: { viewProj: IDENTITY, viewport: drawn.viewport },
  pagePosition: (_page: 0, _h: 0, k: number) => [...drawn.triangle[k]],
  // The corner carries its own `w`: the position the shader extends with 1 is already clip space.
  vec4f: (v: number[], one: number) => (v.length === 4 ? v : [...v, one]),
})

/** `vertexFacing` of `FACING_WGSL`, as shipped, on clip-space corners and a target size. */
function vertexFacing(cull: number, triangle: Triangle, viewport: readonly [number, number]) {
  drawn.triangle = triangle
  drawn.viewport.splice(0, 2, ...viewport)
  return shipped.vertexFacing(cull, IDENTITY, 0, 0, [0, 1, 2])
}
const { facingDiscarded } = shipped

/** A 1920 × 1080 target: one pixel is 2/1920 of clip x, 2/1080 of clip y at w = 1. */
const HD = [1920, 1080] as const
const facing = (cull: number, triangle: Triangle) => vertexFacing(cull, triangle, HD)

/** Sides that draw the triangle, given the facing the rasteriser settles on. */
const drawnBy = (triangle: Triangle, front: boolean) =>
  [1, 2].filter((cull) => {
    const mode = facing(cull, triangle)
    return mode !== FACING_DROP && !facingDiscarded(mode, front)
  })

const ccw: Triangle = [
  [0, 0, 0.5, 1],
  [0.5, 0, 0.5, 1],
  [0, 0.5, 0.5, 1],
]

test('a certain triangle is decided by the vertex stage alone, by one side', () => {
  assert.equal(facing(1, ccw), FACING_DROP, 'the front side mode drops a front face')
  assert.equal(facing(2, ccw), 0, 'the other keeps it, nothing left to the fragment')
  const cw: Triangle = [ccw[0], ccw[2], ccw[1]]
  assert.equal(facing(1, cw), 0)
  assert.equal(facing(2, cw), FACING_DROP)
})

test('a flat triangle is never drawn by both sides nor dropped by both', () => {
  const flat: Triangle = [
    [0, 0, 0.5, 1],
    [0.4, 0.4, 0.5, 1],
    [0.8, 0.8, 0.5, 1],
  ]
  // Exactly zero in float: left to the rasteriser's facing, whichever it is.
  for (const front of [true, false]) assert.equal(drawnBy(flat, front).length, 1)
})

test('a sliver the float sign cannot settle goes to the fragment stage', () => {
  const sliver: Triangle = [
    [-0.9, 0.3, 0.5, 1],
    [0.9, 0.3 + 1e-6, 0.5, 1],
    [0, 0.3, 0.5, 1],
  ]
  assert.equal(facing(1, sliver), 1, 'kept, carrying its mode')
  assert.equal(facing(2, sliver), 2)
  for (const front of [true, false]) assert.equal(drawnBy(sliver, front).length, 1)
})

test('a sliver certain in float but thinner than a snapping step goes to the fragment stage', () => {
  // A 200-pixel sliver a thirtieth of a pixel thick: its float determinant is far above rounding,
  // yet a four-bit sub-pixel grid can move a corner across its width and flip its facing.
  const thin: Triangle = [
    [0, 0, 0.5, 1],
    [200 * (2 / 1920), 0, 0.5, 1],
    [100 * (2 / 1920), (1 / 30) * (2 / 1080), 0.5, 1],
  ]
  assert.equal(facing(1, thin), 1, 'kept, carrying its mode')
  assert.equal(facing(2, thin), 2)
  // The same shape a pixel thick is certain on every grid.
  const thick: Triangle = [thin[0], thin[1], [thin[2][0], 2 / 1080, 0.5, 1]]
  assert.equal(facing(1, thick), FACING_DROP)
  assert.equal(facing(2, thick), 0)
})

test('a triangle the frustum clips, a corner behind the eye, or a NaN, is left to the rasteriser', () => {
  const behind: Triangle = [ccw[0], ccw[1], [0, 1, 0.5, -1]]
  assert.equal(facing(1, behind), 1)
  const beyondNear: Triangle = [ccw[0], ccw[1], [0, 0.5, -0.1, 1]]
  assert.equal(facing(1, beyondNear), 1, 'the near plane clips it')
  const offScreen: Triangle = [ccw[0], ccw[1], [0, 1.5, 0.5, 1]]
  assert.equal(facing(2, offScreen), 2, 'the viewport clips it')
  const broken: Triangle = [ccw[0], ccw[1], [Number.NaN, 1, 0.5, 1]]
  assert.equal(facing(2, broken), 2)
})

test('every triangle is drawn by exactly one side, whatever its shape', () => {
  let seed = 7
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 8
  for (let n = 0; n < 5000; n++) {
    const triangle = [0, 1, 2].map(() => [next(), next(), next(), next()]) as unknown as Triangle
    for (const front of [true, false]) {
      // A certain triangle: the rasteriser agrees with its sign; a doubtful one may say either.
      const mode = facing(1, triangle)
      if (mode !== 1 && (mode === FACING_DROP) !== front) continue
      assert.equal(drawnBy(triangle, front).length, 1, JSON.stringify(triangle))
    }
  }
})

test('the blend module runs the facing test and discards on front_facing', () => {
  assert.match(BLEND_SHADER, /fn vertexFacing\(/)
  assert.match(BLEND_SHADER, /facingDiscarded\(in\.water>>16u,front\)/)
  assert.doesNotMatch(BLEND_SHADER, /fn vertexCulled\(/, 'one facing test, not two')
  assert.match(
    wgslModule(waterSurfaceWgsl(true)),
    /\(in\.water&65535u\)/,
    'the water rank stored without the mode',
  )
})
