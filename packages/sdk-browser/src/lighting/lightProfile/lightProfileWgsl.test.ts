// Where a point falls in a light's profile: the shipped WGSL, run in single precision, against a twin
// written in double precision from the frame's definition, at the poles, the equator and the
// tangent axis of a light.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import {
  LIGHT_PROFILE_BITS,
  LIGHT_PROFILE_SHIFT,
} from '../../../../sdk-core/src/scene/light/contracts.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import {
  LIGHT_PROFILE_COORDINATES_WGSL,
  lightProfileMultiplierWgsl,
  lightProfileOfWgsl,
  NO_LIGHT_PROFILE_WGSL,
} from './lightProfileWgsl.ts'

type V3 = [number, number, number]

const code = wgslModule(LIGHT_PROFILE_COORDINATES_WGSL)
const { lightProfileCoordinates } = shaderRun<{
  lightProfileCoordinates: (P: V3, light: V3, direction: V3, tangent: V3) => [number, number]
}>(code, ['lightProfileCoordinates'], { ...F32_SCOPE, ...wgslConstants(code) })

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: V3): V3 => {
  const length = Math.hypot(...a)
  return [a[0] / length, a[1] / length, a[2] / length]
}
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** The coordinates by definition, in double precision: the frame (direction, bitangent, tangent),
 *  the vertical coordinate from the arcsine of the direction's share of the unit vector toward the
 *  light, the horizontal one from the angle in the (bitangent, tangent) plane. */
function twin(P: V3, light: V3, direction: V3, tangent: V3): [number, number] {
  const bitangent = unit(cross(tangent, direction))
  const toLight = unit([light[0] - P[0], light[1] - P[1], light[2] - P[2]])
  const along = Math.min(1, Math.max(-1, dot(toLight, direction)))
  const b = dot(toLight, bitangent),
    t = dot(toLight, tangent)
  const angle = b === 0 && t === 0 ? 0 : Math.atan2(-t, -b)
  return [Math.asin(along) / Math.PI + 0.5, angle / (2 * Math.PI) + 0.5]
}

// A light at the origin shining along -z, its up +y: its bitangent is -x.
const LIGHT: V3 = [0, 0, 0]
const SHINE: V3 = [0, 0, -1]
const UP: V3 = [0, 1, 0]

const CASES: { name: string; at: V3; expected: [number, number] }[] = [
  { name: 'straight ahead (the profile’s 0° pole)', at: [0, 0, -5], expected: [0, 0.5] },
  { name: 'straight behind (the 180° pole)', at: [0, 0, 5], expected: [1, 0.5] },
  { name: 'on the equator, above the light', at: [0, 3, 0], expected: [0.5, 0.75] },
  { name: 'on the tangent axis, below the light', at: [0, -3, 0], expected: [0.5, 0.25] },
  {
    name: 'on the equator, on the bitangent’s negative side',
    at: [-3, 0, 0],
    expected: [0.5, 0.5],
  },
]

/** The distance between two horizontal coordinates, which wrap: 0 and 1 are one direction. */
const wrapped = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b))

test('the coordinates are the definition’s at the poles, the equator and the tangent axis', () => {
  for (const { name, at, expected } of CASES) {
    const got = lightProfileCoordinates(at, LIGHT, SHINE, UP)
    const by = twin(at, LIGHT, SHINE, UP)
    assert.ok(Math.abs(got[0] - expected[0]) < 2e-6, `${name}: vertical ${got[0]}`)
    assert.ok(wrapped(got[1], expected[1]) < 2e-6, `${name}: horizontal ${got[1]}`)
    assert.ok(Math.abs(got[0] - by[0]) < 2e-6, `${name}: vertical against the twin`)
    assert.ok(wrapped(got[1], by[1]) < 2e-6, `${name}: horizontal against the twin`)
  }
})

test('on the bitangent’s positive side the horizontal angle is on the seam, 0 or 1', () => {
  const [vertical, horizontal] = lightProfileCoordinates([3, 0, 0], LIGHT, SHINE, UP)
  assert.ok(Math.abs(vertical - 0.5) < 2e-6)
  assert.ok(wrapped(horizontal, 0) < 2e-6, `${horizontal}`)
})

test('a light turned about its direction turns the profile’s horizontal angle with it', () => {
  // The same point read by a light whose up is turned a quarter about the direction: the horizontal
  // coordinate moves by a quarter, the vertical one stays.
  const at: V3 = [1, 2, -3]
  const first = lightProfileCoordinates(at, LIGHT, SHINE, UP)
  const turned = lightProfileCoordinates(at, LIGHT, SHINE, [1, 0, 0])
  assert.ok(Math.abs(first[0] - turned[0]) < 2e-6)
  const shift = (((turned[1] - first[1]) % 1) + 1) % 1
  assert.ok(Math.abs(shift - 0.25) < 5e-6 || Math.abs(shift - 0.75) < 5e-6, `${shift}`)
})

test('points around the light match the twin, whichever way the light faces', () => {
  const faces: [V3, V3][] = [
    [unit([1, -2, 0.5]), unit([0, 0, 1])],
    [unit([-0.3, 0.1, 0.9]), unit([1, 0, 0.3])],
  ]
  for (const [direction, rough] of faces) {
    // The up made perpendicular to the direction, as validation does.
    const along = dot(rough, direction)
    const tangent = unit([
      rough[0] - along * direction[0],
      rough[1] - along * direction[1],
      rough[2] - along * direction[2],
    ])
    for (let i = 0; i < 40; i++) {
      const at: V3 = [Math.sin(i * 1.7) * 6, Math.cos(i * 2.3) * 5, Math.sin(i * 0.9 + 1) * 7]
      const got = lightProfileCoordinates(at, [0.5, 1, -2], direction, tangent)
      const by = twin(at, [0.5, 1, -2], direction, tangent)
      assert.ok(Math.abs(got[0] - by[0]) < 1e-4, `vertical ${i}`)
      const gap = Math.abs(got[1] - by[1])
      assert.ok(Math.min(gap, 1 - gap) < 1e-4, `horizontal ${i}: ${got[1]} ${by[1]}`)
    }
  }
})

test('the multiplier is 1 for a light with no slice, and reads the atlas otherwise', () => {
  const b = { group: 2, atlas: 5, sampler: 6 }
  const text = wgslModule(lightProfileMultiplierWgsl(b))
  assert.ok(text.includes('@group(2) @binding(5) var lightProfileAtlas:texture_2d_array<f32>;'))
  assert.ok(text.includes('@group(2) @binding(6) var lightProfileSampler:sampler;'))
  assert.ok(text.includes('if(slice<0){return 1.0;}'))
  assert.ok(
    text.includes('textureSampleLevel(lightProfileAtlas,lightProfileSampler,at,slice,0.0).r'),
  )
  const read = wgslModule(lightProfileOfWgsl(b))
  assert.ok(
    read.includes(
      `return (kindWord(light)>>${LIGHT_PROFILE_SHIFT}u)&${2 ** LIGHT_PROFILE_BITS - 1}u;`,
    ),
    'the lane is the kind word shifted and masked',
  )
  assert.ok(read.includes('let lane=lightProfileLane(light);'), 'the profile reads that one lane')
  assert.ok(read.includes('emitterAxisOf(light)'))
  assert.ok(read.includes('if(lane==0u){return 1.0;}'))
  assert.ok(read.includes('i32(lane)-1'))
  assert.ok(wgslModule(NO_LIGHT_PROFILE_WGSL).includes('{return 1.0;}'))
})

test('an axis parallel to the direction leaves no frame: the horizontal angle is 0, the vertical one is the definition’s, and nothing is not a number', () => {
  for (const axis of [SHINE, [0, 0, 1] as V3]) {
    const [vertical, horizontal] = lightProfileCoordinates([1, 2, -3], LIGHT, SHINE, axis)
    assert.ok(Number.isFinite(vertical) && Number.isFinite(horizontal))
    assert.equal(horizontal, 0.5, 'the angle taken as 0')
    assert.ok(Math.abs(vertical - twin([1, 2, -3], LIGHT, SHINE, UP)[0]) < 2e-6)
  }
})

test('the axis need not be a unit vector across the direction: only its direction counts', () => {
  const at: V3 = [1, 2, -3]
  const wanted = lightProfileCoordinates(at, LIGHT, SHINE, UP)
  const slanted = lightProfileCoordinates(at, LIGHT, SHINE, unit([0, 1, 0.5]))
  assert.ok(Math.abs(slanted[0] - wanted[0]) < 2e-6)
  assert.ok(
    wrapped(slanted[1], wanted[1]) < 5e-6,
    'the rejection of the axis from the direction is the same tangent',
  )
})
