import test from 'node:test'
import assert from 'node:assert/strict'
import { ObjectPhysics } from './objectPhysics.ts'
import type { SoftBodyOptions } from './soft.ts'
import { softSettings } from './softSettings.ts'

test('soft options out of range are refused, and a soft body keeps its type and settings', () => {
  for (const bad of [{ stretch: -1 }, { bend: Number.NaN }, { mass: -2 }, { pressure: -5 }])
    assert.throws(
      () => new ObjectPhysics({ type: 'volume', ...bad } as SoftBodyOptions),
      RangeError,
    )
  const body = new ObjectPhysics({ type: 'cloth', pins: [1] })
  assert.equal(body.type, 'cloth')
  assert.deepEqual(body.soft, {
    type: 'cloth',
    pins: [1],
    mass: undefined,
    stretch: 0,
    bend: Infinity,
    pressure: 0,
  })
  assert.equal(new ObjectPhysics('dynamic').soft, null)
})

test('an option a soft body cannot take is refused naming it, and a value out of range too', () => {
  for (const name of ['shape', 'sensor', 'ccd', 'decorative'])
    assert.throws(
      () => softSettings({ type: 'cloth', [name]: false } as never),
      (error: unknown) => error instanceof RangeError && error.message.includes(name),
    )
  assert.throws(
    () => softSettings({ type: 'cloth', damping: { angular: 0.1 } } as never),
    (error: unknown) => error instanceof RangeError && error.message.includes('angular'),
  )
  assert.throws(
    () => softSettings({ type: 'cloth', mass: -2 }),
    (error: unknown) =>
      error instanceof RangeError && error.message.includes('mass') && error.message.includes('-2'),
  )
  assert.deepEqual(
    softSettings({ type: 'rope', pressure: 5 } as never).pressure,
    0,
    'a rope holds no gas',
  )
  assert.equal(softSettings({ type: 'volume' }).pressure, undefined, 'a volume’s own')
})
