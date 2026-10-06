import test from 'node:test'
import assert from 'node:assert/strict'
import { Light } from './light.ts'
import { lampCastsShadow, lampRecord, lightFromRecord } from './lightRecord.ts'
import type { SceneLight } from '../../scene/light/contracts.ts'
import { near } from '../../math/near.fixture.ts'

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

test('a spot’s cone is held open below a right angle, its penumbra in [0, 1]', () => {
  const spot = new Light('spot', { position: [0, 2, 0], angle: 0.5 })
  const record = lampRecord(spot, 'c', () => 9)!
  assert.equal(record.coneAngle, 0.5)
  assert.equal('penumbra' in record, false, 'no penumbra when sharp')
  near(record.direction, [0, -1, 0], 'at the origin')
  spot.angle = Math.PI
  spot.penumbra = 3
  const wide = lampRecord(spot, 'c', () => 9)!
  assert.ok(wide.coneAngle! < Math.PI / 2 && wide.coneAngle! > Math.PI / 2 - 1e-8)
  assert.equal(wide.penumbra, 1)
  spot.penumbra = 0.25
  assert.equal(lampRecord(spot, 'c', () => 9)!.penumbra, 0.25)
})

test('a rectangle faces down its −z, its width along its x, and casts no shadow', () => {
  const panel = new Light('rectArea', {
    width: 2,
    height: 1,
    position: [0, 0, 5],
    castShadow: true,
    radius: 1,
  })
  panel.scale.set(3, 1, 1)
  panel.rotation.y = Math.PI / 2
  const record = lampRecord(panel, 'r', () => 9)!
  assert.equal(record.kind, 'rect')
  assert.equal(record.castsShadow, false)
  assert.equal(lampCastsShadow(panel), false)
  near(record.right, [0, 0, -1], 'unit x, turned')
  near(record.direction, [-1, 0, 0], 'faces −z, turned')
  assert.deepEqual(record.size, [2, 1])
  assert.equal(record.emitterRadius, undefined)
  assert.equal(lampCastsShadow(new Light('ambient', { castShadow: true })), false)
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
      coneAngle: 0.4,
      penumbra: 0.5,
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
  const sun = lightFromRecord({
    id: 'd',
    kind: 'directional',
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
    direction: [0, 0, -1],
  })
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
  const aimed = lightFromRecord({ ...records[1], direction: [0.6, -0.8, 0] })
  near(aimed.target.position.toArray(), [0.6, 3.2, 0], 'the target one unit along')
})
