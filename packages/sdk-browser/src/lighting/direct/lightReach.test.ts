// Where a light gives a point energy is one rule (`localLightReaches`, `./lightWgsl.ts`): the
// lighting zeroes a light out of its range, its cone or its rectangle's front, and the shadow-map
// marking and projection, which read the predicate, give the same verdict. On generated lights of
// every kind (`lightReach.fixture.ts`), points just inside and just outside each edge — the range,
// a spot's cone, a rectangle's plane — get the same verdict from the predicate's one home, from the
// deferred lighting's and the bounce irradiance's incidence (one shared text), from the marking's
// call, from the projection's whole region test on the records its host writes, and from the
// bounce's world light lists, which list a superset: every point a light reaches lies in a cell
// that lists it, and a light listed past its reach adds the lighting's exact zero.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionText } from '../../bounce/wgslBody.fixture.ts'
import { localLightReaches } from './lightWgsl.ts'
import { directLightingWgsl } from './lightingWgsl.ts'
import { BOUNCE_PROBE_SHADER } from '../../bounce/probeWgsl.ts'
import { vsmPixelPageMarkingWgsl } from '../../vsm/markingWgsl.ts'
import { vsmLayout } from '../../vsm/layout.ts'
import { CODE as PROJECTION } from '../../vsm/projectionTiles.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { LIGHTS, casesOf, recordOf, type V3 } from './lightReach.fixture.ts'
import { listsOf, projectionOf, reachOf, shadesOf } from './lightReachReaders.fixture.ts'

const LIGHTING = wgslModule(directLightingWgsl({ lobeless: true }))
const MARKING = vsmPixelPageMarkingWgsl(vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 }))
const BOUNCE = BOUNCE_PROBE_SHADER

test('the predicate has one home: the marking and the projection hold its one text, the lighting and the bounce one incidence', () => {
  const home = functionText(localLightReaches, 'localLightReaches')
  for (const code of [MARKING, PROJECTION]) {
    assert.equal(code.split('fn localLightReaches(').length, 2, 'one definition')
    assert.equal(functionText(code, 'localLightReaches'), home)
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
    assert.equal(functionText(BOUNCE, name), functionText(LIGHTING, name), name)
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
