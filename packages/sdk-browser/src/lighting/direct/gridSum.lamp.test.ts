// The lamp's own laws, as the shipped light term gives them, run as JavaScript (`shaderRun`): a spot's fade, a fall-off that is not the
// inverse square, a profiled point light that is no capsule, the shares of diffuse and specular light.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { recordOf } from './lightReach.fixture.ts'
import { unit } from '../../../../math/src/vector/vectorTuple.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { type Vec3 } from '../tiles/tileCamera.fixture.ts'
import { K, NAMES, PROGRAMS, scopeOf } from './gridSum.fixture.ts'

type Sum = (...args: unknown[]) => number[]

const LAMPS = shaderRun<{
  lampReach: (light: object, P: Vec3) => number[]
  isCapsule: (light: object) => boolean
  lampSeen: (
    light: object,
    P: Vec3,
    N: Vec3,
    bias: number,
  ) => { toward: Vec3; falloff: number; wrap: number }
}>(PROGRAMS[0], ['lampReach', 'isCapsule', 'lampSeen'], {
  ...F32_SCOPE,
  ...K,
  directLights: { items: [] },
})
const lampOf = (kind: SceneLight['kind'], extra: Partial<SceneLight> = {}) =>
  recordOf({
    ...{ id: kind, kind, color: [1, 1, 1], intensity: 3, castsShadow: false, range: 20 },
    ...{ position: [1, 2, 0.5], direction: [0, -1, 0], outerConeAngle: 0.8, ...extra },
  })

test('a spot’s fade is the square of a ramp in the cone’s cosine, from its outer cone to its inner one', () => {
  // The inner cone is where the light stops being whole: none by default (the whole cone fades),
  // half the cone, the outer cone itself (a ramp a milliradian wide).
  for (const [extra, inner, outer] of [
    [{}, 0, 0.8],
    [{ innerConeAngle: 0.4 }, 0.4, 0.8],
    [{ innerConeAngle: 0.8 }, 0.8, 0.801],
  ] as const)
    for (const angle of [0, 0.2, 0.4, 0.6, 0.79, 0.8005, 0.81]) {
      const ramp = (Math.cos(angle) - Math.cos(outer)) / (Math.cos(inner) - Math.cos(outer))
      const P: Vec3 = [Math.sin(angle), 2 - Math.cos(angle), 0.5]
      const mask = LAMPS.lampReach(lampOf('spot', { ...extra, position: [0, 2, 0.5] }), P)[3]
      near(mask, Math.min(Math.max(ramp, 0), 1) ** 2, `${inner} ${angle}`, 3e-5)
    }
})

test('a lamp off the inverse square is its mask alone, one less its squared range ratio to its exponent', () => {
  const seen = (extra: Partial<SceneLight>, d: number, bias = 1e-4) =>
    LAMPS.lampSeen(
      lampOf('point', { position: [0, 0, 0], range: 10, ...extra }),
      [d, 0, 0],
      [0, 0, 1],
      bias,
    )
  for (const d of [0.01, 1, 5, 9.9]) {
    const off = (1 - (d / 10) ** 2) ** 8
    near(seen({ inverseSquared: false }, d).falloff, off, `exponent 8 at ${d}`, 3e-5)
    const two = seen({ inverseSquared: false, radialExponent: 2 }, d, 0).falloff
    near(two, (1 - (d / 10) ** 2) ** 2, `exponent 2 at ${d}`, 3e-5)
    const squared = (1 - (d / 10) ** 4) ** 2 / (d * d + 1e-4)
    near(seen({}, d).falloff, squared, `the inverse square at ${d}`, 3e-5)
  }
  // A source widens nothing of the mask, but its horizon still wraps by the inverse square.
  const wide = seen({ inverseSquared: false, emitterRadius: 0.5 }, 1)
  near([wide.falloff, wide.wrap], [0.99 ** 8, 0.25 / (1 + 1e-4)], 'a sphere', 3e-5)
  // A rectangle is no lamp of size, whatever its axis lane holds.
  assert.equal(LAMPS.isCapsule(lampOf('rect', { right: [1, 0, 0], size: [2, 1] })), false)
})

test('a point light with a profile and no tube is no capsule and is lit as the same light without the profile; a tube still is a capsule', () => {
  const seen = (record: object) => LAMPS.lampSeen(record, [3, 0, 0.5], [0, 0, 1], 1e-4)
  const bare = lampOf('point', { position: [0, 0, 0], range: 10 })
  const profiled = lampOf('point', {
    position: [0, 0, 0],
    range: 10,
    direction: [0, 0, -1],
    iesProfile: 'p',
    emitterAxis: [1, 0, 0],
  })
  assert.equal(LAMPS.isCapsule(bare), false)
  assert.equal(LAMPS.isCapsule(profiled), false, 'the profile’s axis makes no tube')
  assert.deepEqual(seen(profiled), seen(bare), 'lit exactly as the same light without a profile')
  const tube = lampOf('point', {
    position: [0, 0, 0],
    range: 10,
    emitterLength: 2,
    emitterAxis: [1, 0, 0],
  })
  assert.equal(LAMPS.isCapsule(tube), true)
  assert.notDeepEqual(
    seen(tube).toward,
    seen(bare).toward,
    'the tube path: its mean direction is not the centre’s',
  )
  const both = lampOf('point', {
    position: [0, 0, 0],
    range: 10,
    direction: [0, 0, -1],
    iesProfile: 'p',
    emitterLength: 2,
    emitterAxis: [1, 0, 0],
  })
  assert.equal(LAMPS.isCapsule(both), true)
  assert.deepEqual(seen(both), seen(tube), 'a profiled tube is lit as the tube')
})

test('a light’s shares weigh its diffuse and its specular light: the term is their sum, weighed', () => {
  const lights = { count: 1, items: [] as object[] }
  const { sliceLighting } = shaderRun<{ sliceLighting: Sum }>(
    PROGRAMS[0],
    NAMES,
    scopeOf(PROGRAMS[0], lights, []),
  )
  const lit = (extra: Partial<SceneLight>, [diffuseShare, specularShare]: number[]) => {
    const light = { ...extra, diffuseShare, specularShare }
    lights.items = [lampOf(extra.kind ?? 'point', light)]
    const surface = [[0.8, 0.7, 0.6], 0.2, 0.5, [0, 1, 0], [0.6, 0.8, 0], [0, 0, 0], 1]
    return sliceLighting(...surface, [K.TILE_NO_SLICE, 1])
  }
  const kinds: Partial<SceneLight>[] = [
    { kind: 'point' },
    { kind: 'point', emitterRadius: 0.3 },
    { kind: 'point', emitterLength: 1, emitterAxis: [0, 0, 1] },
    { kind: 'spot' },
    { kind: 'directional', direction: unit([-0.2, -1, -0.1]) },
  ]
  for (const extra of kinds) {
    const [diffuse, specular, both, mixed] = [
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, 0.25],
    ].map((s) => lit(extra, s))
    const label = JSON.stringify(extra)
    assert.ok(diffuse.every((c) => c > 0) && specular.every((c) => c > 0), `${label}: both lit`)
    near(
      both,
      diffuse.map((c, i) => c + specular[i]),
      `${label}: the whole`,
      1e-5,
    )
    near(
      mixed,
      diffuse.map((c, i) => 0.5 * c + 0.25 * specular[i]),
      `${label}: weighed`,
      1e-5,
    )
  }
})
