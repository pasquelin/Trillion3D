// A soft body that diverges, or that the solver throws apart on a box, is brought back to a shape
// it kept; one whose pins hang inside a static body passes through it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { plane, sphere } from '../../../sdk-core/src/world/geometry/basic.ts'
import { readPoints } from '../../../sdk-core/src/world/geometry/bounds.ts'
import {
  PHYSICS_STEP,
  BODY_INDEX,
  CommandWriter,
  EVENT,
  FLAG,
  softBodyOf,
  type SoftBodyOptions,
} from '../../../sdk-core/src/physics/index.ts'
import { SOFT_DAMPING } from '../../../sdk-core/src/physics/soft.ts'
import { softSettings } from '../../../sdk-core/src/physics/softSettings.ts'
import { events } from './module.fixture.ts'
import { addSoft, at, BOX, CLOTH, softWorld, stepped, strayed } from './soft.fixture.ts'
import { thrownCloth } from './softScenes.fixture.ts'
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
function diagonal(vertices: Float32Array) {
  const [lo, hi] = [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ]
  vertices.forEach(
    (x, i) => ((lo[i % 3] = Math.min(lo[i % 3], x)), (hi[i % 3] = Math.max(hi[i % 3], x))),
  )
  return Math.hypot(...hi.map((h, k) => h - lo[k]))
}

test('a soft body that diverges before it kept a good state is brought back to its rest shape, named, and kept', async () => {
  // Blown out of its size, its edges torn, in its first step: its rest shape around its centre of
  // mass, which nothing within it moved (gravity alone took it down a step's fall), not around the
  // middle of its scattered vertices.
  const free = await blown(1e5)
  const [{ vertices, recovered, diverged }] = stepped(free.jolt, free.record, 1 / 60)
  assert.deepEqual([recovered, diverged], [[CLOTH], []], 'named, never taken out')
  const offset = [0, 1, 2].map((k) => vertices![k] - free.rest[k])
  assert.ok(strayed(vertices!, free.rest, offset) < 1e-5, 'its rest shape')
  assert.ok(Math.hypot(...offset) < 5e-3, `around its centre of mass: ${offset}`)
})

test('a fine cloth the solver throws apart on a box is brought back to where it was a quarter second before, calmed, and rests on it', async () => {
  // A 1.5 m cloth of 44 × 44 squares dropped 0.7 m onto a static 1 m box: the solver finds each
  // vertex's collision plane once per step, and the cloth folding over the box's edges goes apart
  // in a few steps (1e5 m in a second without the restore).
  const { jolt, record, cloth } = await thrownCloth()
  // Its states from the one it was made in, its rest shape (kept as it was added).
  const sent: Float32Array[] = [Float32Array.from(readPoints(cloth.getAttribute('position')!))]
  const brought: number[] = []
  let [last, quiet] = [null as Float32Array | null, 0]
  for (const { vertices, recovered, diverged } of stepped(jolt, record, 12)) {
    assert.deepEqual(diverged, [], 'never non-finite')
    if (recovered.length) brought.push(sent.length)
    quiet = vertices ? 0 : quiet + 1
    last = vertices ?? last
    sent.push(vertices ?? last!)
    // Never written spread past three times its rest diagonal (2.12 m).
    if (vertices) assert.ok(diagonal(vertices) < 3 * 2.13, `step ${sent.length - 1}: spread`)
  }
  assert.ok(brought.length >= 1 && brought.length <= 3, `brought back ${brought.length} times`)
  // Back to a state it was in, kept 15 to 30 steps before it diverged (here the one it was made
  // in), at rest.
  const k = brought[0]
  const back = sent
    .slice(Math.max(0, k - 31), k - 14)
    .findIndex((was) => strayed(sent[k], was) < 1e-4)
  assert.ok(back >= 0, `step ${k}: a state it was in a quarter to half a second before`)
  // Calmed, it settles on the box and sleeps, never thrown apart again: its corners cannot fold (its
  // shear is as stiff as its stretch, 0), so its middle rests within 10 cm above the top (1.51 m,
  // 0.69 m below where it was made), its edges hanging, above the floor.
  assert.ok(quiet >= 60, 'at rest: the module stopped sending it')
  const middle = at(last!, 22 * 45 + 22)
  assert.ok(middle[2] > -0.7 && middle[2] < -0.59, `its middle on the box: ${middle}`)
  assert.ok(
    Math.min(...last!.filter((_, i) => i % 3 === 2)) > -1.5,
    'its edges hang above the floor',
  )
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
