// The surface a hit has between its triangle's corners, run from the shipped text: the interpolated coordinate, normal and colour.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { sceneHitCornersWgsl } from './sceneHitCornersWgsl.ts'
import {
  RAY_TRACING_FLAG_ATTRIBUTES,
  RAY_TRACING_FLAG_NORMALS,
} from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'

type Corner = [number, number, number, number]
interface Surface {
  uv: [number, number]
  normal: [number, number, number]
  colour: [number, number, number, number]
}

const bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]
const corner = (u: number, v: number, normal: number, colour: number): Corner => [
  bits(u),
  bits(v),
  normal,
  colour,
]
const packColour = (r: number, g: number, b: number, a: number) =>
  (r | (g << 8) | (b << 16) | (a << 24)) >>> 0

const run = (corners: Corner[]) =>
  shaderRun<{
    stCornerSurface: (triangle: number, bary: [number, number], normalled: boolean) => Surface
  }>(sceneHitCornersWgsl({ group: 1, first: 0 }), ['stCornerSurface'], {
    stTable: corners.flat(),
    stParams: { cornerWord: 0 },
    unpack2x16snorm: (w: number) => [((w << 16) >> 16) / 32767, (w >> 16) / 32767],
    unpack4x8unorm: (w: number) => [0, 8, 16, 24].map((s) => ((w >>> s) & 255) / 255),
  })

test('the coordinate and the colour are interpolated by the weights', () => {
  const white = packColour(255, 255, 255, 255)
  const corners = [
    corner(0, 0, 0, white),
    corner(2, 0, 0, white),
    corner(0, 4, 0, packColour(0, 0, 0, 255)),
  ]
  const s = run(corners).stCornerSurface(0, [0.25, 0.5], false)
  assert.deepEqual(s.uv, [0.5, 2])
  assert.ok(Math.abs(s.colour[0] - 0.5) < 1e-6)
  assert.deepEqual(
    s.normal,
    [0, 0, 0],
    'corners without a normal (the record not flagged) give none',
  )
})

test('a triangle past the first is read at its own corners', () => {
  const white = packColour(255, 255, 255, 255)
  const corners = [
    corner(0, 0, 0, white),
    corner(2, 0, 0, white),
    corner(0, 4, 0, white),
    corner(9, 9, 0, white),
    corner(9, 9, 0, white),
    corner(9, 9, 0, white),
  ]
  const surface = run(corners)
  assert.deepEqual(surface.stCornerSurface(0, [0.25, 0.5], false).uv, [0.5, 2])
  assert.deepEqual(surface.stCornerSurface(1, [0.25, 0.5], false).uv, [9, 9])
})

test('the normal is the unit vector of the corners’ octahedral codes', () => {
  // The code zero is the pole, a +z normal like any other.
  const n = corner(0, 0, 0, 0)
  const s = run([n, n, n]).stCornerSurface(0, [0.3, 0.3], true)
  assert.ok(Math.abs(Math.hypot(...s.normal) - 1) < 1e-5)
  assert.ok(s.normal[2] > 0.999)
})

test('the surface reads the record’s attribute and normal flags from the triangle', () => {
  const text = wgslSource(sceneHitCornersWgsl({ group: 1, first: 0 }))
  assert.match(text, new RegExp(`\\(flags&${RAY_TRACING_FLAG_ATTRIBUTES}u\\)!=0u`))
  assert.match(text, new RegExp(`\\(flags&${RAY_TRACING_FLAG_NORMALS}u\\)!=0u`))
  assert.match(text, /fn stHitSurface\(hit:StHit\)->StHitSurface\{/)
  assert.match(text, /stCornerSurface\(hit\.triangle,hit\.bary,/)
})
