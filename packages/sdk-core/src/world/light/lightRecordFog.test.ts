// A lamp's share of the fog and its shadow on the fog: recorded only where they differ from the default,
// and read back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Light } from './light.ts'
import { lampRecord, lightFromRecord } from './lightRecord.ts'

test('the fog share and the shadow-on-fog flag reach the record only when they differ from the default', () => {
  const plain = lampRecord(new Light('point'), 'a', () => 9)!
  assert.equal(plain.fogScattering, undefined)
  assert.equal(plain.shadowsFog, undefined)
  const sun = lampRecord(new Light('directional'), 'a', () => 9)!
  assert.equal(sun.shadowsFog, undefined, 'a directional light shadows the fog by default')
  const tuned = new Light('point', { fogScattering: 0.5, shadowsFog: true })
  const record = lampRecord(tuned, 'a', () => 9)!
  assert.equal(record.fogScattering, 0.5)
  assert.equal(record.shadowsFog, true)
  const back = lightFromRecord(record)
  assert.equal(back.fogScattering, 0.5)
  assert.equal(back.shadowsFog, true)
  const off = new Light('directional', { shadowsFog: false })
  assert.equal(lampRecord(off, 'a', () => 9)!.shadowsFog, false)
  off.shadowsFog = true
  assert.equal(lampRecord(off, 'a', () => 9)!.shadowsFog, undefined, 'back to the default')
})

test('the transmission switch is off by default, reaches the record when on, comes back and is copied', () => {
  assert.equal(lampRecord(new Light('point'), 'a', () => 9)!.transmission, undefined)
  const lamp = new Light('point', { transmission: true })
  const record = lampRecord(lamp, 'a', () => 9)!
  assert.equal(record.transmission, true)
  assert.equal(lightFromRecord(record).transmission, true)
  assert.equal(lamp.clone().transmission, true)
  lamp.transmission = false
  assert.equal(lampRecord(lamp, 'a', () => 9)!.transmission, undefined)
})
