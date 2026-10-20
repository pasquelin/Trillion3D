// A soft body's bend floor is reckoned with the page's step (`jolt_init`): at the default
// step, bit for bit as the module that had 1/60 s compiled in; at another, the same per second.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { plane } from '../../../../sdk-core/src/world/geometry/basic.ts'
import { PHYSICS_STEP } from '../../../../sdk-core/src/physics/options.ts'
import { SOFT_DAMPING } from '../../../../sdk-core/src/physics/soft/soft.ts'
import type { Module } from '../module.fixture.ts'
import { addSoft, at, settle, softWorld, stepped, strayed } from './soft.fixture.ts'
import { clampedCloth, thrownCloth } from './softScenes.fixture.ts'
import { FLAT } from '../records.fixture.ts'

/** Steps `jolt` `seconds` in its own steps, `record`'s soft body in it: a SHA-256 of every step's
 *  soft words, in order. */
function digest({ jolt, record }: { jolt: Module; record: { map: Uint32Array } }, seconds: number) {
  const hash = createHash('sha256')
  for (const step of stepped(jolt, record, seconds)) hash.update(step.words)
  return { soft: hash.digest('hex') }
}

/** Taken with the module whose soft step was compiled in (`ENGINE_STEP = 1.0f / 60`, `soft.cpp`),
 *  before the page's step reached it: the calm of the cloth thrown apart on a box (`thrownCloth`). A change of the solver moves them: they are then
 *  taken again, the module before that change and the one after giving the same. */
const COMPILED_STEP = {
  thrown: {
    // Re-pinned once the rollback chain left the module (its calm moved the thrown cloth), then
    // once a soft body started just off its rest shape (`SOFT_IMPERFECTION`, `soft.cpp`;
    // `5c31a026…` before, which the module built with no imperfection still gives).
    soft: '7fb56212b875c3b4769bc64ad5f28bc7d948e98ef7360266738ebfd0c6b590db',
  },
}

test("at the page's default step, the bend floor steps bit for bit as the step compiled in", async () => {
  const thrown = await thrownCloth()
  assert.deepEqual({ thrown: digest(thrown, 3) }, COMPILED_STEP)
})

test('at another step, a soft body falls and bends the same per second; a bend its solver cannot resolve follows the step', async () => {
  const [slow, fast] = [PHYSICS_STEP, PHYSICS_STEP / 2]
  // Falling a second under its own damping c: (g / c)·(t − (1 − e^(−c·t)) / c) down, 4.052 m.
  const fall = (9.81 / SOFT_DAMPING) * (1 - (1 - Math.exp(-SOFT_DAMPING)) / SOFT_DAMPING)
  const [fell60, fell120] = await Promise.all(
    [slow, fast].map(async (step) => {
      const jolt = await softWorld(undefined, step)
      const record = addSoft(jolt, plane(1, 1, 10, 10), { type: 'cloth' }, [0, 20, 0], {
        ...{ quaternion: FLAT, linearDamping: SOFT_DAMPING },
      })
      return -at(settle(jolt, record, 1), 5)[2]
    }),
  )
  // Each substep h (a fifth of the step) takes its speed before its place, which overshoots the
  // fall by at most g·h·t / 2: 1.6 cm in a second at 60 Hz, half that at 120.
  ;[fell60, fell120].forEach((fell, i) => {
    const overshoot = (9.81 * ([slow, fast][i] / 5)) / 2
    assert.ok(Math.abs(fell - fall) < overshoot, `fell ${fell} m, ${fall} m`)
  })
  // Clamped along two rows, a bend the solver resolves at both steps (20 rad/(N·m)) rests alike:
  // the solver lets each of the ten edges down to its tip give `h² / m` a newton (6.7 mm for a
  // vertex of 1.65 g at 60 Hz, a quarter at 120) under at most the weight below a row, 0.18 N on
  // each of its 11 edges: 1.2 cm in all, the most the two may part.
  const [bent60, bent120] = await Promise.all([clampedCloth(20, slow), clampedCloth(20, fast)])
  assert.ok(strayed(bent60, bent120) < 0.012, 'a resolved bend rests alike')
  // Declared stiffer (0.001), it is held at the stiffest a substep of the page's step resolves
  // (`SOFT_BEND_FLOOR`): at 120 Hz its tip bows 7 cm rather than 28, and less than the 13 cm of a
  // module that still reckoned its floor at 1/60 s, by more than half that 6 cm gap.
  const tips = await Promise.all([
    clampedCloth(0.001, slow),
    clampedCloth(0.001, fast),
    clampedCloth(0.001, fast, slow),
  ])
  const [floored60, floored120, compiled120] = tips.map((vertices) => at(vertices, 5)[2])
  assert.ok(floored60 < -0.27 && floored60 > -0.3, `at 60 Hz: ${floored60}`)
  assert.ok(floored120 > compiled120 + 0.03, `the floor follows: ${floored120}, ${compiled120}`)
})
