// The soft scenes several tests step: the fine cloth the solver throws apart on a box, and a cloth
// clamped along two rows.
import { CommandWriter, PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts'
import { SOFT_DAMPING } from '../../../sdk-core/src/physics/soft.ts'
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts'
import { addSoft, BOX, settle, softWorld } from './soft.fixture.ts'
import { FLAT, body } from './records.fixture.ts'

/** A 1.5 m cloth of 44 × 44 squares dropped 0.7 m onto a static 1 m box, stepped at `step`:
 *  at 60 Hz the solver throws it apart as it folds over the box's edges. */
export async function thrownCloth(step = PHYSICS_STEP) {
  const jolt = await softWorld(undefined, step)
  const writer = new CommandWriter()
  writer.add({ ...body(BOX, 0, 1, 0.5) })
  jolt.step(writer.take(), 0)
  const cloth = plane(1.5, 1.5, 44, 44)
  const record = addSoft(jolt, cloth, { type: 'cloth' }, [0, 2.2, 0], {
    ...{ quaternion: FLAT, linearDamping: SOFT_DAMPING },
  })
  return { jolt, record, cloth }
}

/** The two last rows of 11 vertices of a 1 m cloth of 10 × 10 squares, its pins below. */
const clamp = Array.from({ length: 22 }, (_, i) => 99 + i)

/** A 1 m cloth of 10 cm squares laid flat at 3 m, clamped along its two last rows and bent by
 *  `bend`, damped by 2, made in a module stepped by `moduleStep` and settled 3 s in steps of
 *  `step`: its vertices. */
export async function clampedCloth(bend: number, step = PHYSICS_STEP, moduleStep = step) {
  const jolt = await softWorld(undefined, moduleStep)
  const options = { type: 'cloth' as const, pins: clamp, bend }
  const record = addSoft(jolt, plane(1, 1, 10, 10), options, [0, 3, 0], {
    ...{ quaternion: FLAT, linearDamping: 2 },
  })
  return settle(jolt, record, 3, step)
}
