// A scenario writes only the settings the world gives a setter.
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyWorldSettings } from './scenario.ts'

class FakeWorld {
  #shadows = 'on'
  plain = 1
  get shadows() {
    return this.#shadows
  }
  set shadows(value: string) {
    this.#shadows = value
  }
  get error() {
    return null
  }
  dispose() {}
}

test('a setting with a setter, on the prototype, is written', () => {
  const world = new FakeWorld()
  applyWorldSettings(world, { world: { shadows: 'off' } })
  assert.equal(world.shadows, 'off')
})

test('a name without a setter is a named failure, whatever else the world holds under it', () => {
  const world = new FakeWorld()
  for (const name of ['error', 'dispose', 'plain', 'nothing', 'constructor', '__proto__'])
    assert.throws(
      () => applyWorldSettings(world, { world: { [name]: 1 } }),
      new RegExp(`BENCH_SCENARIO.*${name}`),
      name,
    )
  assert.equal(world.plain, 1, 'nothing was written')
})

test('a segment that names no settings writes nothing', () => {
  assert.doesNotThrow(() => applyWorldSettings(new FakeWorld(), {}))
})
