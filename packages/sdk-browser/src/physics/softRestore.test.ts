// A soft body's input is bounded when it is made, so it never runs away; one whose pins hang
// inside a static body passes through it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { plane, sphere } from '../../../sdk-core/src/world/geometry/basic.ts'
import { readPoints } from '../../../sdk-core/src/world/geometry/bounds.ts'
import { PHYSICS_STEP } from '../../../sdk-core/src/physics/options.ts'
import { BODY_INDEX, EVENT, FLAG } from '../../../sdk-core/src/physics/layout.ts'
import { CommandWriter } from '../../../sdk-core/src/physics/commands.ts'
import {
  softBodyOf,
  type SoftBodyOptions,
  SOFT_DAMPING,
} from '../../../sdk-core/src/physics/soft.ts'

import { softSettings } from '../../../sdk-core/src/physics/softSettings.ts'
import { events } from './module.fixture.ts'
import { addSoft, at, BOX, CLOTH, softWorld, stepped } from './soft.fixture.ts'
import { FLAT, body } from './records.fixture.ts'

/** A 0.3 m ball whose gas is `pressure` Pa (no page gives it so much: its skin cannot hold it):
 *  its record, the module stepping it, and its rest vertices. */
async function blown(pressure: number) {
  const jolt = await softWorld()
  const shape = sphere(0.3, 12, 8)
  const options: SoftBodyOptions = { type: 'volume' }
  const made = softBodyOf(shape, { x: 1, y: 1, z: 1 }, softSettings(options), PHYSICS_STEP)
  const record = addSoft(jolt, shape, options, [0, 3, 0], {
    ...{ record: { ...made, pressure }, linearDamping: 0.05 },
  })
  return { jolt, record, rest: readPoints(shape.getAttribute('position')!) }
}

/** The diagonal of the bounds of `vertices`. */
function diagonal(vertices: ArrayLike<number>) {
  const [lo, hi] = [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ]
  Array.prototype.forEach.call(
    vertices,
    (x: number, i: number) => (
      (lo[i % 3] = Math.min(lo[i % 3], x)), (hi[i % 3] = Math.max(hi[i % 3], x))
    ),
  )
  return Math.hypot(...hi.map((h, k) => h - lo[k]))
}

// Its input bounded when it is made (`soft.cpp`): whatever its solver does, no vertex outruns the
// faster of its swing and its fall through its damping, and none goes non-finite.
test('a ball blown past what its skin holds stays within its speed bound, finite, never taken out', async () => {
  const { jolt, record, rest } = await blown(1e6)
  const swing = Math.sqrt(2 * 9.81 * 100 * diagonal(rest)),
    bound = Math.max(swing, 9.81 / 0.05) * PHYSICS_STEP
  let last: Float32Array | null = null
  for (const { vertices, diverged } of stepped(jolt, record, 2)) {
    assert.deepEqual(diverged, [], 'never non-finite')
    if (vertices && last)
      for (let i = 0; i < vertices.length; i += 3) {
        const travel = Math.hypot(
          vertices[i] - last[i],
          vertices[i + 1] - last[i + 1],
          vertices[i + 2] - last[i + 2],
        )
        assert.ok(travel <= bound * 1.001, `${i / 3}: ${travel} past ${bound}`)
      }
    last = vertices ?? last
  }
})

test('a soft body passes through the static body its pins hang inside; laid on one, it lies on it', async () => {
  // A cloth whose middle row is pinned through a 0.5 m box: the rows by the pins start inside it.
  const jolt = await softWorld()
  const writer = new CommandWriter()
  writer.add({ ...body(BOX, 0, 3, 0.25, FLAG.events) })
  jolt.step(writer.take(), 0)
  const row = (r: number) => Array.from({ length: 11 }, (_, i) => r * 11 + i)
  const hung = addSoft(jolt, plane(1, 1, 10, 10), { type: 'cloth', pins: row(5) }, [0, 3, 0], {
    ...{ quaternion: FLAT, linearDamping: SOFT_DAMPING },
  })
  writer.flags(CLOTH & BODY_INDEX, FLAG.events)
  jolt.step(writer.take(), 0)
  let last: Float32Array | null = null
  for (const { vertices } of stepped(jolt, hung, 15)) {
    last = vertices ?? last
    for (const [type, a, b] of events(jolt))
      assert.ok(type !== EVENT.begin || (a !== BOX && b !== BOX), 'the box is never touched')
  }
  // The rows under the middle pin hang straight down through the box, as if it were not there.
  for (const [r, depth] of [
    [4, 0.1],
    [3, 0.2],
  ]) {
    const [x, y, z] = at(last!, r * 11 + 5)
    assert.ok(Math.hypot(x, y, z + depth) < 0.01, `row ${r}: ${[x, y, z]}`)
  }
  // A cloth laid on a table, pinned along its middle: its pins lie on the top, not in it.
  const table = await softWorld()
  writer.add({ ...body(BOX, 0, 0.5, 0.5), size: [1, 0.5, 1] })
  table.step(writer.take(), 0)
  const laid = addSoft(table, plane(1, 1, 10, 10), { type: 'cloth', pins: row(5) }, [0, 1, 0], {
    ...{ quaternion: FLAT, linearDamping: SOFT_DAMPING },
  })
  for (const { vertices } of stepped(table, laid, 2))
    if (vertices)
      for (let v = 2; v < vertices.length; v += 3)
        assert.ok(vertices[v] > -1e-3, `vertex ${(v - 2) / 3} sank into the table: ${vertices[v]}`)
})
