import test from 'node:test'
import assert from 'node:assert/strict'
import { Light } from './light.ts'
import { lampRecord, lightFromRecord } from './lightRecord.ts'
import type { SceneLight } from '../../scene/light/contracts.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { HALF_PI } from '../../../../math/src/constants.ts'

test('only a lamp giving light is recorded', () => {
  for (const kind of ['ambient', 'hemisphere', 'probe'])
    assert.equal(
      lampRecord(new Light(kind), 'a', () => 9),
      null,
    )
  assert.equal(
    lampRecord(new Light('point', { intensity: 0 }), 'a', () => 9),
    null,
  )
  assert.equal(
    lampRecord(new Light('point', { intensity: NaN }), 'a', () => 9),
    null,
  )
})

test('a point lamp: where it is, how far it reaches, how wide it glows', () => {
  const light = new Light('point', {
    color: [1, 0.5, 0],
    intensity: 3,
    position: [1, 2, 3],
    castShadow: true,
  })
  assert.deepEqual(
    lampRecord(light, 'p', () => 40),
    {
      id: 'p',
      kind: 'point',
      color: [1, 0.5, 0],
      intensity: 3,
      castsShadow: true,
      position: [1, 2, 3],
      range: 40,
    },
  )
  light.distance = 5
  light.radius = 0.5
  assert.equal(
    lampRecord(light, 'p', () => 40)?.range,
    5,
    'its own distance before the world’s reach',
  )
  assert.equal(lampRecord(light, 'p', () => 40)?.emitterRadius, 0.5)
  light.radius = 5
  assert.equal(
    lampRecord(light, 'p', () => 40)?.emitterRadius,
    undefined,
    'no wider than its reach',
  )
})

test('the world’s reach is asked only of a lamp the page left unbounded', () => {
  let asked = 0
  const reach = () => (asked++, 40)
  lampRecord(new Light('directional'), 'd', reach)
  lampRecord(new Light('point', { distance: 5 }), 'p', reach)
  lampRecord(new Light('point', { intensity: 0 }), 'q', reach)
  assert.equal(asked, 0, 'a sun, a bounded lamp and a dark one ask nothing')
  assert.equal(lampRecord(new Light('spot'), 's', reach)?.range, 40)
  assert.equal(asked, 1)
  let seen: number[] = []
  lampRecord(new Light('point', { position: [1, 2, 3] }), 'w', (at) => ((seen = at.toArray()), 1))
  assert.deepEqual(seen, [1, 2, 3], 'seen from where the lamp stands in the world')
})

test('a directional lamp aims from its place at its target, straight down when they meet', () => {
  const sun = new Light('directional', { position: [0, 3, 4], target: [0, 0, 0] })
  const record = lampRecord(sun, 's', () => 9)!
  near(record.direction, [0, -0.6, -0.8], 'direction')
  assert.equal('position' in record || 'range' in record, false, 'no place, no reach')
  const flat = new Light('directional', { position: [1, 1, 1], target: [1, 1, 1] })
  near(lampRecord(flat, 's', () => 9)!.direction, [0, -1, 0], 'degenerate aim')
})

test('a directional lamp is the air’s sun or its second light: the index reaches its record and its clone', () => {
  const sun = new Light('directional')
  assert.equal(sun.atmosphereSunIndex, 0)
  assert.equal(
    'atmosphereSunIndex' in lampRecord(sun, 's', () => 9)!,
    false,
    'the default stays out',
  )
  const moon = new Light('directional', { atmosphereSunIndex: 1 })
  assert.equal(lampRecord(moon, 'm', () => 9)!.atmosphereSunIndex, 1)
  assert.equal(moon.clone().atmosphereSunIndex, 1, 'a clone keeps it')
  moon.atmosphereSunIndex = 0
  assert.equal(
    'atmosphereSunIndex' in lampRecord(moon, 'm', () => 9)!,
    false,
    'back to the default',
  )
  assert.throws(() => (moon.atmosphereSunIndex = 2 as 0), /atmosphereSunIndex expects 0 or 1/)
  assert.throws(() => new Light('directional', { atmosphereSunIndex: -1 as 0 }), /expects 0 or 1/)
})

test('a directional lamp’s shadow distance reaches its record unless it is the default, and its clone', () => {
  const sun = new Light('directional')
  assert.equal(sun.shadowDistance, 400, 'the reference’s 400 metres')
  assert.equal(
    'shadowDistance' in lampRecord(sun, 's', () => 9)!,
    false,
    'the default stays out of the record',
  )
  const near600 = new Light('directional', { shadowDistance: 600 })
  assert.equal(lampRecord(near600, 'n', () => 9)!.shadowDistance, 600)
  assert.equal(near600.clone().shadowDistance, 600, 'a clone keeps it')
  const none = new Light('directional', { shadowDistance: false })
  assert.equal(lampRecord(none, 'n', () => 9)!.shadowDistance, 0, 'false is none: 0')
  assert.equal(new Light('directional', { shadowDistance: true }).shadowDistance, 400)
  none.shadowDistance = 400
  assert.equal('shadowDistance' in lampRecord(none, 'n', () => 9)!, false, 'back to the default')
  // A lamp that is not a sun takes none, and records none.
  for (const kind of ['point', 'spot'] as const) {
    const lamp = new Light(kind, { position: [0, 2, 0], shadowDistance: 50 })
    assert.equal('shadowDistance' in lampRecord(lamp, 'l', () => 9)!, false, kind)
  }
  const stored = lightFromRecord({
    id: 'd',
    kind: 'directional',
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: true,
    direction: [0, -1, 0],
    shadowDistance: 250,
  })
  assert.equal(stored.shadowDistance, 250)
  assert.equal(lampRecord(stored, 'd', () => 9)!.shadowDistance, 250, 'recorded back')
})

test('a lamp’s source — radius, soft radius, a tube along its own up — reaches its record and comes back', () => {
  const lamp = new Light('point', {
    position: [1, 2, 3],
    radius: 0.2,
    softRadius: 0.1,
    tubeLength: 2,
  })
  const upright = lampRecord(lamp, 'p', () => 9)!
  assert.deepEqual(
    [upright.emitterRadius, upright.emitterSoftRadius, upright.emitterLength],
    [0.2, 0.1, 2],
  )
  near(upright.emitterAxis, [0, 1, 0], 'up by default')
  // Turned a quarter about z, the lamp's own up lies along −x: the tube follows its node.
  lamp.rotation.z = HALF_PI
  const turned = lampRecord(lamp, 'p', () => 9)!
  near(turned.emitterAxis, [-1, 0, 0], 'turned with the node')
  const again = lampRecord(lightFromRecord(turned), 'p', () => 9)!
  assert.deepEqual(
    [again.emitterRadius, again.emitterSoftRadius, again.emitterLength],
    [0.2, 0.1, 2],
  )
  near(again.emitterAxis, [-1, 0, 0], 'and comes back')
  // No tube, no axis; a radius past the range is left out, as the source radius is.
  const sphere = lampRecord(new Light('point', { radius: 0.2 }), 'p', () => 9)!
  assert.deepEqual([sphere.emitterLength, sphere.emitterAxis], [undefined, undefined])
  assert.equal(
    lampRecord(new Light('point', { softRadius: 12 }), 'p', () => 9)!.emitterSoftRadius,
    undefined,
  )
  const spot = lampRecord(new Light('spot', { tubeLength: 1 }), 's', () => 9)!
  assert.equal(spot.emitterLength, 1, 'a spot too')
})

test('a spot’s cones are held open below a right angle, its inner cone from 0', () => {
  const spot = new Light('spot', { position: [0, 2, 0], outerConeAngle: 0.5 })
  const record = lampRecord(spot, 'c', () => 9)!
  assert.equal(record.outerConeAngle, 0.5)
  assert.equal('innerConeAngle' in record, false, 'no inner cone by default: the whole cone fades')
  near(record.direction, [0, -1, 0], 'at the origin')
  spot.outerConeAngle = Math.PI
  const wide = lampRecord(Object.assign(spot, { innerConeAngle: 3 }), 'c', () => 9)!
  assert.ok(wide.outerConeAngle! < HALF_PI && wide.outerConeAngle! > HALF_PI - 1e-8)
  assert.equal(wide.innerConeAngle, wide.outerConeAngle)
  for (const [given, held] of [
    [-1, 0],
    [0.25, 0.25],
  ])
    assert.equal(
      lampRecord(Object.assign(spot, { innerConeAngle: given }), 'c', () => 9)!.innerConeAngle,
      held,
    )
})

test('a rectangle faces down its −z, its width along its x, and casts a shadow where it asks', () => {
  const panel = new Light('rectArea', {
    width: 2,
    height: 1,
    position: [0, 0, 5],
    castShadow: true,
    radius: 1,
  })
  panel.scale.set(3, 1, 1)
  panel.rotation.y = HALF_PI
  const record = lampRecord(panel, 'r', () => 9)!
  assert.equal(record.kind, 'rect')
  assert.equal(record.castsShadow, true)
  panel.castShadow = false
  assert.equal(lampRecord(panel, 'r', () => 9)!.castsShadow, false)
  near(record.right, [0, 0, -1], 'unit x, turned')
  near(record.direction, [-1, 0, 0], 'faces −z, turned')
  assert.deepEqual(record.size, [2, 1])
  assert.equal(record.emitterRadius, undefined)
  assert.ok(!lampRecord(new Light('ambient', { castShadow: true }), 'a', () => 9), 'no lamp')
})

test('a stored lamp becomes a light that records back to it', () => {
  const records: SceneLight[] = [
    {
      id: 'p',
      kind: 'point',
      color: [1, 0, 0],
      intensity: 2,
      castsShadow: true,
      position: [1, 2, 3],
      range: 7,
      emitterRadius: 0.5,
    },
    {
      id: 's',
      kind: 'spot',
      color: [0, 1, 0],
      intensity: 1,
      castsShadow: false,
      position: [0, 4, 0],
      range: 9,
      direction: [0, -1, 0],
      outerConeAngle: 0.4,
      innerConeAngle: 0.2,
    },
    {
      id: 'r',
      kind: 'rect',
      color: [1, 1, 1],
      intensity: 5,
      castsShadow: false,
      position: [0, 1, 0],
      range: 9,
      direction: [0, 0, -1],
      right: [1, 0, 0],
      size: [2, 3],
    },
  ]
  for (const record of records) {
    const light = lightFromRecord(record)
    assert.equal(light.name, record.id)
    // JSON reads −0 as 0: a turned axis may carry one.
    assert.deepEqual(
      JSON.parse(JSON.stringify(lampRecord(light, record.id, () => 99))),
      record,
      record.kind,
    )
  }
  const sunRecord: SceneLight = {
    id: 'd',
    kind: 'directional',
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
    direction: [0, 0, -1],
  }
  const sun = lightFromRecord(sunRecord)
  assert.deepEqual([...sun.position.toArray()], [-0, -0, 1], 'placed one unit back along its aim')
  near(lampRecord(sun, 'd', () => 9)!.direction, [0, 0, -1], 'aim')
  const down = lightFromRecord({
    id: 'x',
    kind: 'directional',
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
  })
  near(lampRecord(down, 'x', () => 9)!.direction, [0, -1, 0], 'no direction: straight down')
  near(down.position.toArray(), [0, 1, 0], 'from one unit above')
  const moon = lightFromRecord({ ...sunRecord, atmosphereSun: false, atmosphereSunIndex: 1 })
  assert.deepEqual([moon.atmosphereSun, moon.atmosphereSunIndex], [false, 1], 'what lights the air')
  const aimed = lightFromRecord({ ...records[1], direction: [0.6, -0.8, 0] })
  near(aimed.target.position.toArray(), [0.6, 3.2, 0], 'the target one unit along')
})
