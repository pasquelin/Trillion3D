import test from 'node:test'
import assert from 'node:assert/strict'
import { flyTick, immersionOf, modeOf, swimTick } from './characterModes.ts'
import { HUMAN_BODY } from './characterSettings.ts'

const run = (tick: () => void, seconds: number, h = 1 / 60) => {
  for (let t = 0; t < seconds; t += h) tick()
}

test('a flying body gathers speed toward its wish and stops at the top speed', () => {
  const v = new Float64Array(3)
  run(() => flyTick(v, [1, 0, 0], HUMAN_BODY, 1 / 60), 10)
  assert.ok(v[0] <= HUMAN_BODY.flySpeed + 1e-9 && v[0] > HUMAN_BODY.flySpeed * 0.95, `${v[0]}`)
  assert.ok(Math.abs(v[1]) < 1e-9 && Math.abs(v[2]) < 1e-9)
})

test('a flying body with no key is slowed by the fluid alone, ever nearer rest', () => {
  const v = Float64Array.of(6, 2, 0)
  run(() => flyTick(v, [0, 0, 0], HUMAN_BODY, 1 / 60), 20)
  assert.ok(Math.hypot(...v) < 1e-2, `${v}`)
})

test('a swimmer fully submerged floats: buoyancy cancels its weight', () => {
  const v = new Float64Array(3)
  run(() => swimTick(v, [0, 0, 0], HUMAN_BODY, 1, 9.80665, 1 / 60), 5)
  assert.ok(Math.abs(v[1]) < 1e-9)
})

test('a swimmer half submerged sinks slower than it falls, a dry one falls', () => {
  const half = new Float64Array(3)
  swimTick(half, [0, 0, 0], { ...HUMAN_BODY, buoyancy: 0.5 }, 1, 10, 1)
  assert.ok(half[1] < 0 && half[1] > -10)
  const none = new Float64Array(3)
  swimTick(none, [0, 0, 0], HUMAN_BODY, 0, 10, 0.1)
  assert.ok(Math.abs(none[1] + 1) < 0.05, `${none[1]}`)
})

test('a swimmer is held to the swim speed, and rising out of the water is slowed', () => {
  const v = new Float64Array(3)
  run(() => swimTick(v, [0, 0, 1], HUMAN_BODY, 1, 9.80665, 1 / 60), 10)
  assert.ok(Math.abs(v[2]) <= HUMAN_BODY.swimSpeed + 1e-9)
  const up = Float64Array.of(0, 2.5, 0)
  swimTick(up, [0, 0, 0], HUMAN_BODY, 0.5, 9.80665, 1 / 60)
  assert.ok(up[1] < 1.2, `${up[1]}`)
})

test('the mode follows the setting, the water and the floor', () => {
  const s = { flying: false, canSwim: true }
  assert.equal(modeOf(s, false, true), 'walking')
  assert.equal(modeOf(s, false, false), 'falling')
  assert.equal(modeOf(s, true, true), 'swimming')
  assert.equal(modeOf({ ...s, canSwim: false }, true, false), 'falling')
  assert.equal(modeOf({ ...s, flying: true }, true, true), 'flying')
  assert.deepEqual(immersionOf(0, 2, 1), 0.5)
  assert.deepEqual(immersionOf(0, 2, 9), 1)
})
