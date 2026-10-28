// The `cuts` scenario cuts one stochastic part at a time through the world's accessors, and a segment's settings reach them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyWorldSettings, readScenario } from './scenario.ts'

test('the cuts scenario is a whole view then one cut at a time, each captured', () => {
  const { segments } = readScenario('cuts')
  assert.deepEqual(
    segments.map((s) => s.name),
    ['whole', 'taa off', 'shadows off', 'probes off', 'occlusion off', 'reflections off'],
  )
  assert.ok(segments.every((s) => s.capture && s.frames > 0))
})

test('a segment writes its settings through the world’s accessors, and refuses a name the world lacks', () => {
  // A world whose settings are accessors with setters, as the engine's are.
  class FakeWorld {
    #antialiasing: unknown = true
    #shadows: unknown = {}
    get temporalAntialiasing() {
      return this.#antialiasing
    }
    set temporalAntialiasing(value: unknown) {
      this.#antialiasing = value
    }
    get shadows() {
      return this.#shadows
    }
    set shadows(value: unknown) {
      this.#shadows = value
    }
  }
  const world = new FakeWorld()
  applyWorldSettings(world, {
    world: { temporalAntialiasing: false, shadows: { shadowQuality: 0 } },
  })
  assert.equal(world.temporalAntialiasing, false)
  assert.deepEqual(world.shadows, { shadowQuality: 0 })
  assert.throws(
    () => applyWorldSettings(world, { world: { nothing: 1 } }),
    /no setting nothing to write/,
  )
})
