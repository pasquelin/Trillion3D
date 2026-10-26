// Where a light gives a point energy is one rule (`localLightReaches`, `./lightWgsl.ts`): the
// lighting zeroes a light out of its range, its cone or its rectangle's front, and the shadow-map
// marking and projection, which read the predicate, give the same verdict. On generated lights of
// every kind (`lightReach.fixture.ts`), points just inside and just outside each edge — the range,
// a spot's cone, a rectangle's plane — get the same verdict from the predicate's one home, from the
// deferred lighting's and the surface cache's direct light's lamp (one shared text), from the marking's
// call and from the projection's whole region test on the records its host writes. How much a lamp
// gives there is one law too: the inverse square of its distance a square centimetre longer,
// windowed by its range, or the light's own fall-off where it asks for another, a lamp of size's
// the capsule's (`lampSeen`), a spot's fade the square of a ramp in its cone's cosine.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../materials/texture/shaderRule.fixture.ts'
import { localLightReaches } from './lightReachWgsl.ts'
import { directLightingWgsl } from './lightLoop.fixture.ts'
import { DIRECT_WGSL } from '../surfaceCache/lighting/directWgsl.ts'
import { vsmPixelPageMarkingWgsl } from '../shadows/vsm/markingWgsl.ts'
import { vsmLayout } from '../shadows/vsm/layout.ts'
import { PROJECTION_CODE } from '../shadows/vsm/projection/projectionRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { LIGHT_KIND, type SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { NO_CONE, sourceRadiusOf } from '../../../../sdk-core/src/scene/light/fields.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { LIGHTS, casesOf, recordOf, type V3 } from './lightReach.fixture.ts'
import { projectionOf, projectionRecords, reachOf, shadesOf } from './lightReachReaders.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'

const LIGHTING = wgslModule(directLightingWgsl({ lobeless: true }))
const MARKING = vsmPixelPageMarkingWgsl(vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 }))
const CACHE = DIRECT_WGSL

test('the predicate has one home: the marking and the projection hold its one text, the lighting and the cache’s direct light one lamp', () => {
  const home = functionsOf(localLightReaches, ['localLightReaches'])
  for (const code of [MARKING, PROJECTION_CODE]) {
    assert.equal(code.split('fn localLightReaches(').length, 2, 'one definition')
    assert.equal(functionsOf(code, ['localLightReaches']), home)
  }
  // The marking's call, on the vector from the point to the light and the light buffer's record.
  assert.ok(MARKING.includes('let lightShiftedPosition=vsmLightShiftedPosition(light);'))
  assert.ok(MARKING.includes('let d=lightShiftedPosition-shiftedPosition;'))
  assert.ok(MARKING.includes('let rect=isRect(light);'))
  assert.ok(
    MARKING.includes(
      'if(!localLightReaches(d,light.positionRange.w,light.directionCone.w,light.directionCone.xyz,rect)){continue;}',
    ),
  )
  // The deferred lighting and the cache's direct light shade with one lamp text, in which the sum
  // `1 / (d² + bias)` is formed in one place: no incidence is formed apart from `lampSeen`.
  for (const name of ['lampReach', 'lampSeen', 'capsuleLamp', 'rangeWindow', 'rectView'])
    assert.equal(functionsOf(CACHE, [name]), functionsOf(LIGHTING, [name]), name)
  for (const gone of ['directIncidence', 'inverseOf', 'SPOT_EDGE', 'LINE_FLOOR'])
    assert.ok(!LIGHTING.includes(gone), `${gone} is gone`)
})

test('on generated lights of every kind, points just inside and just outside each edge get one verdict from every reader', () => {
  const home = reachOf(localLightReaches),
    marking = reachOf(MARKING),
    lighting = shadesOf(LIGHTING),
    cache = shadesOf(CACHE)
  // Every light casts: a rectangle is marked and projected as a point light is.
  const projection = projectionOf(LIGHTS)
  const seen = new Map<string, number>()
  for (const [k, light] of LIGHTS.entries()) {
    const r = recordOf(light)
    for (const { P, inside, edge } of casesOf(light, r)) {
      const key = `${light.kind} ${edge} ${inside}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
      const label = `${light.id}, ${edge}, ${inside ? 'inside' : 'outside'}, at ${P}`
      assert.equal(lighting(light, r, P), inside, `the lighting: ${label}`)
      assert.equal(cache(light, r, P), inside, `the cache's direct light: ${label}`)
      if (light.kind !== 'directional') {
        // The marking's arguments: the light buffer's record, the vector to the light.
        const offset = r.positionRange.slice(0, 3).map((x, i) => x - P[i]) as V3
        const forward = r.directionCone.slice(0, 3) as V3
        const args = [
          offset,
          r.positionRange[3],
          r.directionCone[3],
          forward,
          light.kind === 'rect',
        ] as const
        assert.equal(home(...args), inside, `the predicate: ${label}`)
        assert.equal(marking(...args), inside, `the marking: ${label}`)
      }
      assert.equal(projection(k, P), inside, `the projection: ${label}`)
    }
  }
  // Every kind's every edge, from both sides; a sun reaches every point.
  for (const key of ['point range', 'spot range', 'spot cone', 'rect range', 'rect plane'])
    for (const inside of [true, false])
      assert.ok((seen.get(`${key} ${inside}`) ?? 0) > 0, `${key}, ${inside}`)
  assert.ok((seen.get('directional sun true') ?? 0) > 0)
})

test('a point exactly in a rectangle’s plane is in front of it, for every reader', () => {
  const panel: SceneLight = {
    ...{ id: 'panel', kind: 'rect', position: [0, 3, 0], range: 10, direction: [0, -1, 0] },
    ...{ right: [1, 0, 0], size: [2, 1], color: [1, 1, 1], intensity: 1, castsShadow: true },
  }
  const r = recordOf(panel)
  const onPlane = [3, 3, 0] as V3,
    behind = [3, 3.01, 0] as V3
  const args = (P: V3) =>
    [
      r.positionRange.slice(0, 3).map((x, i) => x - P[i]) as V3,
      r.positionRange[3],
      r.directionCone[3],
      r.directionCone.slice(0, 3) as V3,
      true,
    ] as const
  const [home, marking, projection, lighting] = [
    reachOf(localLightReaches),
    reachOf(MARKING),
    projectionOf([panel]),
    shadesOf(LIGHTING),
  ]
  for (const [P, reached] of [
    [onPlane, true],
    [behind, false],
  ] as const) {
    assert.equal(home(...args(P)), reached, `the predicate at ${P}`)
    assert.equal(marking(...args(P)), reached, `the marking at ${P}`)
    assert.equal(projection(0, P), reached, `the projection at ${P}`)
    assert.equal(lighting(panel, r, P), reached, `the lighting at ${P}`)
  }
})

test('a rectangle’s half width is its source radius for the projection, the marking and the lighting', () => {
  // A rectangle 1.5 m wide, a point 3 m before its face; a normal a little past edge-on faces the
  // wide disk (`vsmFacesAwayFromLocal`: the sine of its half angle, 0.25) and turns from a narrow one.
  const panel = (width: number): SceneLight => ({
    ...{ id: 'panel', kind: 'rect', position: [0, 3, 0], range: 10, direction: [0, -1, 0] },
    ...{ right: [1, 0, 0], size: [width, 1], color: [1, 1, 1], intensity: 1, castsShadow: true },
  })
  const P: V3 = [0, 0, 0]
  const slant: V3 = [0.9797959, -0.2, 0]
  for (const [width, reaches] of [
    [1.5, true],
    [0.1, false],
  ] as const) {
    const light = panel(width)
    assert.equal(projectionOf([light], slant)(0, P), reaches, `the projection, ${width} m wide`)
    // The marking and the trace's cone read the record's own radius: half the width, the same.
    const shape = recordOf(light).shape.slice(0, 3)
    near(Math.hypot(...shape), sourceRadiusOf(light), `${width} m: the buffer's`, 1e-7)
    near(projectionRecords([light])[0].sourceRadius, sourceRadiusOf(light), 'the record', 1e-7)
  }
  // Where a side is under a centimetre the reference holds it to one: the radius is 0.5 cm.
  const sliver = panel(0.001)
  assert.equal(sourceRadiusOf(sliver), 0.005)
  assert.equal(sliver.size![0], 0.001, 'the light itself is as it was declared')
  near(Math.hypot(...recordOf(sliver).shape.slice(0, 3)), 0.005, 'lit as 1 cm wide', 1e-9)
  near(recordOf(sliver).shape[3], 0.5, 'its height is whole', 1e-9)
  near(recordOf({ ...sliver, size: [1, 0.002] }).shape[3], 0.005, 'a height too', 1e-9)
})

test('a rectangle is projected as a point light of its own kind: its source radius half its width, no cone', () => {
  for (const light of LIGHTS.filter((l) => l.kind === 'rect')) {
    const [record] = projectionRecords([light])
    assert.equal(record.kind, LIGHT_KIND.rect, light.id)
    assert.equal(
      record.sourceRadius,
      Math.fround(light.size![0] / 2),
      `${light.id}: half its width`,
    )
    assert.equal(record.cosCone, NO_CONE, `${light.id}: no cone`)
    assert.equal(record.radius, Math.fround(light.range!), `${light.id}: its range`)
  }
})

type Seen = {
  toward: V3
  centre: V3
  falloff: number
  cosine: number
  wrap: number
  lineCos: number
  capsule: boolean
}
const lamps = shaderRun<{
  lampReach: (light: object, P: V3) => number[]
  isCapsule: (light: object) => boolean
  lampSeen: (light: object, P: V3, N: V3, bias: number) => Seen
}>(LIGHTING, ['lampReach', 'isCapsule', 'lampSeen'], {
  ...F32_SCOPE,
  ...wgslConstants(LIGHTING),
  directLights: { items: [] },
})
/** A point lamp at the origin of range `range`, as the light buffer holds it, with a source `radius`
 *  and a tube of `length` along `axis` (the tube's two ends are `±axis · length / 2`). */
const lamp = (range: number, radius = 0, length = 0, axis: V3 = [1, 0, 0]) =>
  recordOf({
    id: 'lamp',
    kind: 'point',
    color: [1, 1, 1],
    intensity: 1,
    position: [0, 0, 0],
    range,
    castsShadow: false,
    ...(radius > 0 ? { emitterRadius: radius } : {}),
    ...(length > 0 ? { emitterLength: length, emitterAxis: axis } : {}),
  })
const BIAS = 1e-4
/** A lamp of range 10's window at distance `d`. */
const window10 = (d: number) => (1 - (d / 10) ** 4) ** 2
/** The lamp `record` seen from `P` at normal `N`, its inverse square a `bias` longer. */
const seen = (record: object, P: V3, N: V3, bias = BIAS) => lamps.lampSeen(record, P, N, bias)

test('a lamp’s attenuation is the inverse square of a distance a square centimetre longer, windowed by its range', () => {
  const record = lamp(10)
  // At the lamp, at 1 cm, 10 cm, 1 m and just inside the range: finite at the lamp.
  for (const d of [0, 0.01, 0.1, 1, 9.5]) {
    const attenuation = seen(record, [d, 0, 0], [1, 0, 0]).falloff
    const want = window10(d) / (d * d + BIAS)
    assert.ok(Math.abs(attenuation - want) <= 2e-6 * want, `${d} m: ${attenuation} against ${want}`)
  }
  assert.equal(seen(record, [10, 0, 0], [1, 0, 0]).falloff, 0, 'zero at the range')
  // The sum form `1 / (d² + bias)` for the two biases the lighting gives: a square centimetre
  // (the surfaces), none (a cache of lit surfaces), at 1 cm, 10 cm and 1 m, for the plain lamp, a
  // sphere and a tube of two ends 10 µm apart (a point to the rounding of its ends); at the lamp's
  // own centre there is no sum with no bias, and the lamp gives that point nothing, not a NaN.
  for (const bias of [BIAS, 0])
    for (const d of [0.01, 0.1, 1]) {
      const want = window10(d) / (d * d + bias)
      for (const shape of [lamp(10), lamp(10, 0.2), lamp(10, 0, 1e-5)]) {
        const got = seen(shape, [-d, 0, 0], [1, 0, 0], bias).falloff
        assert.ok(
          Math.abs(got - want) <= 2e-4 * want,
          `${bias} bias, ${d} m: ${got} against ${want}`,
        )
      }
    }
  for (const shape of [lamp(10), lamp(10, 0.2), lamp(10, 0, 2)]) {
    assert.equal(seen(shape, [0, 0, 0], [1, 0, 0], 0).falloff, 0, 'no sum, no division')
    assert.ok(seen(shape, [0, 0, 0], [1, 0, 0], BIAS).falloff > 0)
  }
})

test('a lamp of size lights as a capsule: the point where it has none, a wrapped horizon, a tube’s falloff', () => {
  // No size: the point's falloff and the plain cosine.
  assert.equal(seen(lamp(10), [1, 0, 0], [1, 0, 0]).capsule, false)
  // A sphere of 0.2 m at 1 m: sin² α = r² times the falloff. Its cosine is the plain one above the
  // horizon's wrap, sin α / 4 level with the horizon, and nothing from −sin α down.
  const sphere = lamp(10, 0.2),
    sin = Math.sqrt(0.04 / (1 + BIAS))
  const lit = (height: number) =>
    seen(sphere, [-Math.sqrt(1 - height * height), 0, -height], [0, 0, 1]).cosine
  for (const [height, want] of [
    [0.5, 0.5],
    [sin, sin],
    [0, sin / 4],
    [-sin, 0],
    [-0.5, 0],
  ])
    assert.ok(Math.abs(lit(height) - want) < 2e-6, `${height}: ${lit(height)} against ${want}`)
  // A tube of 2 m across the way, 1 m away: on its bisector the falloff is that of a point at 1 m,
  // and the directions to its ends are a right angle apart.
  const tube = seen(lamp(10, 0, 2), [0, 0, -1], [0, 0, 1])
  assert.ok(Math.abs(tube.falloff - window10(1) / (1 + BIAS)) < 1e-5)
  assert.ok(Math.abs(tube.lineCos) < 1e-6, `${tube.lineCos}`)
  // A tube of 2 m at 10 cm, 1 m and 3 m off its middle, both biases, by the line's integral
  // `i / (c / 2 + 1 / 2 + bias · i)` from the distances to its ends and the cosine between them.
  for (const bias of [BIAS, 0])
    for (const d of [0.1, 1, 3]) {
      const [e0, e1] = [Math.hypot(1, d), Math.hypot(1, d)],
        i01 = 1 / (e0 * e1),
        c = (d * d - 1) * i01
      const want = (window10(d) * i01) / (c / 2 + 0.5 + bias * i01)
      const got = seen(lamp(10, 0, 2), [0, 0, -d], [0, 0, 1], bias).falloff
      assert.ok(
        Math.abs(got - want) <= 2e-4 * want,
        `tube, ${bias} bias, ${d} m: ${got} against ${want}`,
      )
    }
  // Finite, both biases, at the lamp, on the tube between its ends, at one of its ends.
  for (const P of [
    [0, 0, 0],
    [-0.5, 0, 0],
    [-1, 0, 0],
    [0, 0, -1e-3],
  ] as V3[])
    for (const record of [sphere, lamp(10, 0, 2), lamp(10, 0.2, 2)])
      for (const bias of [BIAS, 0]) {
        const s = seen(record, P, [0, 0, 1], bias)
        const all = [...s.toward, ...s.centre, s.falloff, s.cosine, s.wrap, s.lineCos]
        assert.ok(all.every(Number.isFinite), `${P}, ${bias}: ${all}`)
      }
})
