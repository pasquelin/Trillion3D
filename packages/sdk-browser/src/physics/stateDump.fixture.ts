import { createHash } from 'node:crypto'
import { CommandWriter, EVENT_WORDS, FLAG } from '../../../sdk-core/src/physics/index.ts'
import { plane, sphere } from '../../../sdk-core/src/world/geometry/basic.ts'
import type { JoltModule } from './joltModule.ts'
import { ropeLine, softBodiesIn, writeSoftBody } from './soft.fixture.ts'
import { FLAT, body, id } from './records.fixture.ts'

/** Writes `geometry` as a soft body in slot `slot`, at `position` turned by `quaternion`. */
const soft = (
  writer: CommandWriter,
  slot: number,
  geometry: Parameters<typeof writeSoftBody>[2],
  options: Parameters<typeof writeSoftBody>[3],
  position: number[],
  quaternion?: number[],
) => writeSoftBody(writer, id(slot), geometry, options, position, quaternion)

/** Each body a step's soft words name, and its vertex count. */
const softHeads = (words: Uint32Array) =>
  Uint32Array.from([...softBodiesIn(words)].flatMap((b) => [b.engine, b.count]))

/** A step's events as a set: `motion` holds what was sent, not the order it was sent in, so it is
 *  order-independent by design. Sorted for hashing alone — the accepted route (boss's yes,
 *  29 Sept.): these states match `develop`'s poses, soft words and event set, not its event order,
 *  which the module's own callback order decided and no public API exposes (#934). */
function sortedEvents(words: Uint32Array) {
  const rows = Array.from({ length: words.length / EVENT_WORDS }, (_, r) =>
    words.subarray(r * EVENT_WORDS, (r + 1) * EVENT_WORDS),
  )
  rows.sort((x, y) => {
    const i = x.findIndex((word, k) => word !== y[k])
    return i < 0 ? 0 : x[i] - y[i]
  })
  return Uint32Array.from(rows.flatMap((row) => [...row]))
}

/**
 * A scene of every body kind a pin's long range attachment leaves as it was — boxes piling up
 * with their contact events, an unpinned cloth falling on them, a cloth given stretch hanging from
 * its pins, a rope swinging from its pin, a volume bouncing — stepped `steps` times at 60 Hz.
 * Two SHA-256 of every step's words, in order: `motion`, of its poses, its events as a set (so
 * order-independent by design) and the bodies its soft words name with their vertex counts; `full`,
 * of its poses, its events in the order the engine sent them and whole soft words.
 * `motion` proves the poses, the soft words and the event set equal `develop`'s, not its event
 * order: the canonical order of the records the threads merge is the accepted route (boss's yes,
 * 29 Sept.), the module's own callback order being unreachable through the public API (#934). Two modules
 * that simulate the scene alike give the same `motion`; `full` also holds the written-back vertices
 * bit for bit, which a change of their rounding alone moves (#975).
 */
export function stateDump(
  jolt: Pick<JoltModule, 'step' | 'poses' | 'events' | 'soft'>,
  steps = 240,
) {
  const writer = new CommandWriter()
  writer.gravity([0, -9.81, 0])
  writer.add({ ...body(id(0), 0, -1, 1), size: [20, 1, 20] })
  for (let b = 0; b < 6; b++) {
    const position = [(b % 3) * 0.15 - 0.15, 0.5 + b * 0.4, (b % 2) * 0.1]
    writer.add({ ...body(id(1 + b), 2, 0, 0.1, FLAG.events), position })
  }
  soft(writer, 7, plane(1, 1, 8, 8), { type: 'cloth' }, [0, 3.5, 0], FLAT)
  soft(writer, 8, ropeLine(21, 2), { type: 'rope', pins: [0] }, [2, 3, 0])
  soft(writer, 9, sphere(0.3, 12, 8), { type: 'volume' }, [-2, 1.5, 0])
  const pins = Array.from({ length: 9 }, (_, i) => 72 + i)
  soft(writer, 10, plane(1, 1, 8, 8), { type: 'cloth', pins, stretch: 0.01 }, [0, 3, 3], FLAT)
  writer.flags(7, FLAG.events)
  const motion = createHash('sha256'),
    full = createHash('sha256')
  let posed = jolt.step(writer.take(), 0)
  for (let s = 0; s < steps; s++) {
    const [poses, events, soft] = [jolt.poses(posed), jolt.events(), jolt.soft()]
    motion.update(poses).update(sortedEvents(events)).update(softHeads(soft))
    full.update(poses).update(events).update(soft)
    posed = jolt.step(null, 1 / 60)
  }
  return { motion: motion.digest('hex'), full: full.digest('hex') }
}
