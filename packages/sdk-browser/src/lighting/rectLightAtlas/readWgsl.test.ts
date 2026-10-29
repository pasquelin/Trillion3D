// The read of a rectangle's picture: the program text it assembles into, where a ray meets the face (run in single precision), and the lanes
// the light's slot is read from.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { RECT_SURFACE_LIGHT_WGSL } from '../direct/rectLightWgsl.ts'
import { testLight } from '../direct/testLight.fixture.ts'
import { RECT_PICTURE_HIT_WGSL, rectBindingsOf, rectSourceWgsl } from './readWgsl.ts'

type V = number[]
const BINDINGS = { group: 0, atlas: 83, sampler: 84 }
/** A program that lists `parts` in this order. */
const program = (...parts: WgslDecl[]) => wgslModule(wgslBlock('program', parts, ''))

test('a program that binds the atlas gets the read in place of the white default, once', () => {
  const plain = wgslModule(RECT_SURFACE_LIGHT_WGSL)
  assert.equal(plain.match(/fn rectSourceAt\(/g)?.length, 1)
  assert.ok(plain.includes('return vec3f(1.0);}'), 'a rectangle with no atlas bound is plain')
  assert.ok(!plain.includes('var rectAtlas'), 'and binds nothing')
  const bound = program(RECT_SURFACE_LIGHT_WGSL, rectSourceWgsl(BINDINGS))
  assert.equal(
    bound.match(/fn rectSourceAt\(/g)?.length,
    1,
    'the read replaces the default whichever is listed first',
  )
  assert.ok(bound.includes('@group(0) @binding(83) var rectAtlas:texture_2d<f32>;'))
  assert.ok(bound.includes('@group(0) @binding(84) var rectAtlasSampler:sampler;'))
  assert.ok(bound.includes('textureSampleLevel(rectAtlas,rectAtlasSampler,at,level)'))
  const otherWay = program(rectSourceWgsl(BINDINGS), RECT_SURFACE_LIGHT_WGSL)
  assert.equal(otherWay.match(/fn rectSourceAt\(/g)?.length, 1)
  assert.ok(otherWay.includes('textureSampleLevel(rectAtlas'))
})

test('the bindings a profile’s group names are the rectangle atlas’s', () => {
  assert.deepEqual(rectBindingsOf({ group: 1, rectAtlas: 5, rectSampler: 6 }), {
    group: 1,
    atlas: 5,
    sampler: 6,
  })
})

const hit = shaderRun<{
  rectPictureHit: (a: V, b: V, d: V, L: V) => { uv: V; distance: number; reach: number }
}>(wgslModule(RECT_PICTURE_HIT_WGSL), ['rectPictureHit'], F32_SCOPE)

// A face 4 across and 2 down, two metres from the point along -z, its top left corner at (-2, 1).
const A = [-2, 1, -2]
const B = [2, 1, -2]
const D = [-2, -1, -2]
const unit = (v: V) => v.map((x) => x / Math.hypot(...v))
const close = (a: V, b: V, eps = 1e-5) => a.every((x, i) => Math.abs(x - b[i]) < eps)

test('a ray to a corner of the face meets that corner of the picture, to its centre the middle', () => {
  assert.ok(close(hit.rectPictureHit(A, B, D, unit(A)).uv, [0, 0]))
  assert.ok(close(hit.rectPictureHit(A, B, D, unit(B)).uv, [1, 0]))
  assert.ok(close(hit.rectPictureHit(A, B, D, unit(D)).uv, [0, 1]))
  assert.ok(close(hit.rectPictureHit(A, B, D, unit([2, -1, -2])).uv, [1, 1]))
  assert.ok(close(hit.rectPictureHit(A, B, D, [0, 0, -1]).uv, [0.5, 0.5]))
  // A quarter across and a quarter down the face: x = -1, y = 0.5 at two metres.
  assert.ok(close(hit.rectPictureHit(A, B, D, [-1, 0.5, -2]).uv, [0.25, 0.25]))
})

test('the picture is held to the face: a ray past its edge meets the edge', () => {
  assert.ok(close(hit.rectPictureHit(A, B, D, unit([10, 0, -2])).uv, [1, 0.5]))
  assert.ok(close(hit.rectPictureHit(A, B, D, unit([0, -10, -2])).uv, [0.5, 1]))
})

test('the distance is along the ray, and the reach the square root of the half sides’ product', () => {
  const straight = hit.rectPictureHit(A, B, D, [0, 0, -3])
  assert.ok(
    Math.abs(straight.distance - 2) < 1e-5,
    'the plane is 2 away along the normal ray, whatever the ray’s length',
  )
  const slant = hit.rectPictureHit(A, B, D, unit([1, 0, -1]))
  assert.ok(Math.abs(slant.distance - 2 * Math.SQRT2) < 1e-5)
  // Half sides 2 and 1: reach sqrt(2).
  assert.ok(Math.abs(straight.reach - Math.SQRT2) < 1e-5)
})

test('a ray that grazes the plane is bent to meet it, and a face of no area is a hit at the middle of no reach', () => {
  const grazing = hit.rectPictureHit(A, B, D, [1, 0, 0])
  assert.ok(Number.isFinite(grazing.distance) && grazing.distance > 0)
  const none = hit.rectPictureHit(A, A, A, [0, 0, -1])
  assert.equal(none.reach, 0)
  assert.ok(close(none.uv, [0.5, 0.5]))
})

const frames = shaderRun<{
  ltcCorner: (q: V, T1: V, T2: V, N: V, m: V) => V
  ltcWorld: (d: V, f: { T1: V; T2: V; N: V; m: V; split: V }) => V
  rectView: (light: object, P: V) => { slot: V }
}>(wgslModule(RECT_SURFACE_LIGHT_WGSL), ['ltcCorner', 'ltcWorld', 'rectView', 'faceNormal'], {
  ...F32_SCOPE,
  rangeWindow: () => 1,
})

test('the lobe’s direction is brought back to the world by the inverse of the move the corners made', () => {
  const T1 = [0.6, 0.8, 0]
  const T2 = [-0.8, 0.6, 0]
  const N = [0, 0, 1]
  const m = [1.3, 0.2, -0.1, 0.9]
  const q = [0.3, -0.5, 0.7]
  const moved = frames.ltcCorner(q, T1, T2, N, m)
  const back = frames.ltcWorld(moved, { T1, T2, N, m, split: [0, 0, 0, 0] })
  assert.ok(close(back, q, 1e-5), `${back} is ${q}`)
})

test('a rectangle’s slot is read from the lanes of its record', () => {
  const light = testLight({
    positionRange: [0, 0, 0, 100],
    directionCone: [0, 0, 1, 0],
    shape: [1, 0, 0, 1],
    capsule: [64, 128, 0, 0],
    params: [0, 0, 0, 256],
    traits: [0, 0, 1, 96],
  })
  assert.deepEqual([...frames.rectView(light, [0, 0, 3]).slot], [64, 128, 256, 96])
})
