// A yes/no setting of a light that is on by default is held as the set of the lights turned off, one
// helper for every such setting (`inverseSquared`, `atmosphereSun`): on until a page says `false`, a
// write noted on the light and heard by the world, a copy taking the state of its source.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Light } from './light.ts'
import { lightFlag } from './lightFlags.ts'
import { nodeWrites } from '../../scene/core/nodeEdits.ts'
import { lampRecord } from './lightRecord.ts'
import { brightnessOf } from '../../scene/light/fields.ts'

test('a default-on setting is on until a page says false, and a write to it is noted', () => {
  const flag = lightFlag('shine', true)
  const proto = new Light('point')
  flag.define(proto)
  const named = new Light('point') as Light & { shine: boolean }
  const quiet = new Light('point') as Light & { shine: boolean }
  Object.defineProperty(named, 'shine', Object.getOwnPropertyDescriptor(proto, 'shine')!)
  Object.defineProperty(quiet, 'shine', Object.getOwnPropertyDescriptor(proto, 'shine')!)
  flag.take(named, false)
  flag.take(quiet, undefined)
  assert.deepEqual([named.shine, quiet.shine], [false, true], 'only a false turns it off')
  const before = nodeWrites()
  quiet.shine = false
  assert.equal(quiet.shine, false)
  assert.ok(nodeWrites() > before, 'a write is noted on the light')
  quiet.shine = true
  assert.equal(quiet.shine, true)
  // A copy takes its source's state either way.
  const copy = new Light('point') as Light & { shine: boolean }
  Object.defineProperty(copy, 'shine', Object.getOwnPropertyDescriptor(proto, 'shine')!)
  flag.copy(copy, named)
  assert.equal(copy.shine, false)
  flag.copy(copy, quiet)
  assert.equal(copy.shine, true)
})

test('the lights’ own default-on settings use it: inverse squared and the atmosphere’s sun', () => {
  const sun = new Light('directional'),
    lamp = new Light('point')
  assert.deepEqual([sun.atmosphereSun, lamp.inverseSquared], [true, true])
  sun.atmosphereSun = false
  lamp.inverseSquared = false
  const twin = sun.clone() as Light,
    lampTwin = lamp.clone() as Light
  assert.deepEqual([twin.atmosphereSun, lampTwin.inverseSquared], [false, false], 'copied')
  assert.deepEqual([new Light('point', { atmosphereSun: false }).atmosphereSun], [false])
})

test('a lamp starts at 5000 unitless and a sun at 10 lux; the unit beside it reaches the record', () => {
  // The defaults of a placed light: 5000 unitless, which is 8 candelas, and the sun's 10 lux; the
  // kinds the store does not hold keep 1.
  const kinds = ['point', 'spot', 'rectArea', 'directional', 'ambient']
  assert.deepEqual(
    kinds.map((kind) => new Light(kind).intensity),
    [5000, 5000, 5000, 10, 1],
  )
  const lumens = new Light('point', { intensityUnits: 'lumens' })
  assert.ok(Math.abs(lumens.intensity - 32 * Math.PI) < 1e-12, '8 candelas over 4π')
  const before = nodeWrites()
  lumens.intensityUnits = 'ev'
  assert.ok(nodeWrites() > before, 'a write is noted on the light')
  assert.equal((lumens.clone() as Light).intensityUnits, 'ev', 'copied')
  assert.equal(lampRecord(lumens, 'l', () => 5)?.intensityUnits, 'ev')
  assert.equal('intensityUnits' in lampRecord(new Light('point'), 'p', () => 5)!, false)
  assert.throws(() => new Light('spot', { intensityUnits: 'watts' as never }), /intensityUnits/)
  // A rectangle is 64 cm a side by default: its 8 candelas light as the radiance
  // 8 · 100² / (0.5 · 64 cm · 64 cm) = 39.0625, the same light as a new rect light.
  const panel = new Light('rectArea')
  assert.deepEqual([panel.width, panel.height], [0.64, 0.64])
  const record = lampRecord(panel, 'r', () => 5)!
  assert.ok(Math.abs(brightnessOf(record) - (8 * 1e4) / (0.5 * 64 * 64)) < 1e-12, 'rect radiance')
  // Off the inverse square an EV is a brightness: 0 or under gives nothing, and is not recorded.
  const flat = new Light('point', { intensityUnits: 'ev', intensity: -3, inverseSquared: false })
  assert.equal(
    lampRecord(flat, 'f', () => 5),
    null,
  )
  flat.inverseSquared = true
  assert.equal(lampRecord(flat, 'f', () => 5)?.intensity, -3, 'under it, 2⁻³ candelas')
})
