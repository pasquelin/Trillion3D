// Where a light gives a point energy is one rule (`localLightReaches`, `./lightWgsl.ts`): the
// lighting zeroes a light out of its range, its cone or its rectangle's front, and the shadow-map
// marking and projection, which read the predicate, give the same verdict. On generated lights of
// every kind (`lightReach.fixture.ts`), points just inside and just outside each edge — the range,
// a spot's cone, a rectangle's plane — get the same verdict from the predicate's one home, from the
// deferred lighting's and the bounce irradiance's incidence (one shared text), from the marking's
// call, from the projection's whole region test on the records its host writes, and from the
// bounce's world light lists, which list a superset: every point a light reaches lies in a cell
// that lists it, and a light listed past its reach adds the lighting's exact zero. How much a lamp
// gives there is one law too: the inverse square of its distance a square centimetre longer,
// windowed by its range, a lamp of size's the capsule's (`lampSeen`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../materials/texture/shaderRule.fixture.ts'
import { localLightReaches } from './lightReachWgsl.ts'
import { directLightingWgsl } from './lightingWgsl.ts'
import { BOUNCE_PROBE_SHADER } from '../bounce/probes/probeWgsl.ts'
import { vsmPixelPageMarkingWgsl } from '../shadows/vsm/markingWgsl.ts'
import { vsmLayout } from '../shadows/vsm/layout.ts'
import { PROJECTION_CODE } from '../shadows/vsm/projection/projectionTiles.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { LIGHTS, casesOf, recordOf, type V3 } from './lightReach.fixture.ts'
import { listsOf, projectionOf, reachOf, shadesOf } from './lightReachReaders.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'

const LIGHTING = wgslModule(directLightingWgsl({ lobeless: true }))
const MARKING = vsmPixelPageMarkingWgsl(vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 }))
const BOUNCE = BOUNCE_PROBE_SHADER

test('the predicate has one home: the marking and the projection hold its one text, the lighting and the bounce one incidence', () => {
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
  // The deferred lighting and the bounce irradiance shade with one incidence text.
  for (const name of ['directIncidence', 'rangeWindow', 'rectView'])
    assert.equal(functionsOf(BOUNCE, [name]), functionsOf(LIGHTING, [name]), name)
})

test('on generated lights of every kind, points just inside and just outside each edge get one verdict from every reader', () => {
  const home = reachOf(localLightReaches),
    marking = reachOf(MARKING),
    lighting = shadesOf(LIGHTING),
    bounce = shadesOf(BOUNCE),
    lists = listsOf(BOUNCE)
  // A rectangle casts no shadow: it is neither marked nor projected.
  const shadowed = LIGHTS.filter((light) => light.kind !== 'rect')
  const projection = projectionOf(shadowed)
  const seen = new Map<string, number>()
  for (const light of LIGHTS) {
    const r = recordOf(light),
      k = shadowed.indexOf(light)
    for (const { P, inside, edge } of casesOf(light, r)) {
      const key = `${light.kind} ${edge} ${inside}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
      const label = `${light.id}, ${edge}, ${inside ? 'inside' : 'outside'}, at ${P}`
      assert.equal(lighting(light, r, P), inside, `the lighting: ${label}`)
      assert.equal(bounce(light, r, P), inside, `the bounce irradiance: ${label}`)
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
        if (k >= 0) assert.equal(marking(...args), inside, `the marking: ${label}`)
      }
      if (k >= 0) assert.equal(projection(k, P), inside, `the projection: ${label}`)
      if (inside) assert.ok(lists(r, P), `the bounce lists: ${label}`)
    }
  }
  // Every kind's every edge, from both sides; a sun reaches every point.
  for (const key of ['point range', 'spot range', 'spot cone', 'rect range', 'rect plane'])
    for (const inside of [true, false])
      assert.ok((seen.get(`${key} ${inside}`) ?? 0) > 0, `${key}, ${inside}`)
  assert.ok((seen.get('directional sun true') ?? 0) > 0)
})

type Seen = {
  toward: V3
  falloff: number
  side: number
  cosine: number
  wrap: number
  lineCos: number
  capsule: boolean
}
const lamps = shaderRun<{
  directIncidence: (light: object, P: V3) => number[]
  lampSeen: (light: object, P: V3, N: V3, incidence: number[], bias: number) => Seen
}>(LIGHTING, ['directIncidence', 'lampSeen'], {
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
const seen = (record: object, P: V3, N: V3, bias = BIAS) =>
  lamps.lampSeen(record, P, N, lamps.directIncidence(record, P), bias)

test('a lamp’s attenuation is the inverse square of a distance a square centimetre longer, windowed by its range', () => {
  const record = lamp(10)
  // At the lamp, at 1 cm, 10 cm, 1 m and just inside the range: finite at the lamp, half the old
  // floor at a centimetre, a hundredth less at a decimetre.
  for (const d of [0, 0.01, 0.1, 1, 9.5]) {
    const attenuation = lamps.directIncidence(record, [d, 0, 0])[3]
    const want = window10(d) / (d * d + BIAS)
    assert.ok(Math.abs(attenuation - want) <= 2e-6 * want, `${d} m: ${attenuation} against ${want}`)
  }
  assert.equal(Math.round(lamps.directIncidence(record, [0.01, 0, 0])[3]), 5000)
  assert.equal(lamps.directIncidence(record, [10, 0, 0])[3], 0, 'zero at the range')
  // A cache of lit surfaces takes the squared distance itself, held at a square centimetre: the
  // plain lamp and the sphere and tube alike.
  for (const [d, want] of [
    [0, 1e4],
    [0.01, 1e4],
    [0.1, 100 * window10(0.1)],
    [1, window10(1)],
  ])
    for (const shape of [lamp(10), lamp(10, 0.2), lamp(10, 0, 1e-4)])
      assert.ok(
        Math.abs(seen(shape, [-d, 0, 0], [1, 0, 0], 0).falloff - want) <= 2e-4 * want,
        `${d}`,
      )
})

test('a lamp of size lights as a capsule: the point where it has none, a wrapped horizon, a tube’s falloff', () => {
  // No size: the incidence's own falloff and the plain cosine.
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
  // As its length goes to nothing the tube is the point.
  const short = seen(lamp(10, 0, 1e-4), [0, 0, -2], [0, 0, 1])
  assert.ok(Math.abs(short.falloff - window10(2) / (4 + BIAS)) < 1e-5 * short.falloff)
  // Finite at the lamp, on the tube between its ends, at one of its ends.
  for (const P of [
    [0, 0, 0],
    [-0.5, 0, 0],
    [-1, 0, 0],
    [0, 0, -1e-3],
  ] as V3[])
    for (const record of [sphere, lamp(10, 0, 2), lamp(10, 0.2, 2)]) {
      const s = seen(record, P, [0, 0, 1])
      assert.ok([...s.toward, s.falloff, s.cosine].every(Number.isFinite), `${P}: ${s.falloff}`)
    }
})
