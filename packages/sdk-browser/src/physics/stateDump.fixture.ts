import { createHash } from 'node:crypto';
import { CommandWriter, FLAG } from '../../../sdk-core/src/physics/index.ts';
import { plane, sphere } from '../../../sdk-core/src/world/geometry/basic.ts';
import type { JoltModule } from './joltModule.ts';
import { id, ropeLine, softBodiesIn, writeSoftBody } from './soft.fixture.ts';
import { FLAT, body } from './records.fixture.ts';

/** Writes `geometry` as a soft body in slot `slot`, at `position` turned by `quaternion`. */
const soft = (
  writer: CommandWriter,
  slot: number,
  geometry: Parameters<typeof writeSoftBody>[2],
  options: Parameters<typeof writeSoftBody>[3],
  position: number[],
  quaternion?: number[],
) => writeSoftBody(writer, id(slot), geometry, options, position, quaternion);

/** Each body a step's soft words name, and its vertex count. */
const softHeads = (words: Uint32Array) =>
  Uint32Array.from([...softBodiesIn(words)].flatMap((b) => [b.engine, b.count]));

/**
 * A scene of every body kind a pin's long range attachment leaves as it was — boxes piling up
 * with their contact events, an unpinned cloth falling on them, a cloth given stretch hanging from
 * its pins, a rope swinging from its pin, a volume bouncing — stepped `steps` times at 60 Hz.
 * Two SHA-256 of every step's words, in order: `motion`, of its poses, events and the bodies its
 * soft words name with their vertex counts; `full`, of its poses, events and whole soft words.
 * Two modules that simulate it alike give the same `motion`; `full` also holds the written-back
 * vertices bit for bit, which a change of their rounding alone moves (#975).
 */
export function stateDump(
  jolt: Pick<JoltModule, 'step' | 'poses' | 'events' | 'soft'>,
  steps = 240,
) {
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add({ ...body(id(0), 0, -1, 1), size: [20, 1, 20] });
  for (let b = 0; b < 6; b++) {
    const position = [(b % 3) * 0.15 - 0.15, 0.5 + b * 0.4, (b % 2) * 0.1];
    writer.add({ ...body(id(1 + b), 2, 0, 0.1, FLAG.events), position });
  }
  soft(writer, 7, plane(1, 1, 8, 8), { type: 'cloth' }, [0, 3.5, 0], FLAT);
  soft(writer, 8, ropeLine(21, 2), { type: 'rope', pins: [0] }, [2, 3, 0]);
  soft(writer, 9, sphere(0.3, 12, 8), { type: 'volume' }, [-2, 1.5, 0]);
  const pins = Array.from({ length: 9 }, (_, i) => 72 + i);
  soft(writer, 10, plane(1, 1, 8, 8), { type: 'cloth', pins, stretch: 0.01 }, [0, 3, 3], FLAT);
  writer.flags(7, FLAG.events);
  const motion = createHash('sha256'),
    full = createHash('sha256');
  let posed = jolt.step(writer.take(), 0);
  for (let s = 0; s < steps; s++) {
    const [poses, events, soft] = [jolt.poses(posed), jolt.events(), jolt.soft()];
    motion.update(poses).update(events).update(softHeads(soft));
    full.update(poses).update(events).update(soft);
    posed = jolt.step(null, 1 / 60);
  }
  return { motion: motion.digest('hex'), full: full.digest('hex') };
}
