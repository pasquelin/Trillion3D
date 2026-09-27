import { createHash } from 'node:crypto';
import {
  CommandWriter,
  FLAG,
  GENERATION_SHIFT,
  softBodyOf,
  writeSoft,
  type SoftBodyOptions,
} from '../../../sdk-core/src/physics/index.ts';
import { softSettings } from '../../../sdk-core/src/physics/soft.ts';
import { plane, sphere } from '../../../sdk-core/src/world/geometry/basic.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import type { JoltModule } from './joltModule.ts';
import { body } from './module.fixture.ts';
import { FLAT, ropeLine } from './soft.fixture.ts';

/** Generation 1 of slot `slot`'s engine id. */
const id = (slot: number) => slot | (1 << GENERATION_SHIFT);

/** Writes `geometry` as a soft body in slot `slot`, at `position` turned by `quaternion`. */
function soft(
  writer: CommandWriter,
  slot: number,
  geometry: Geometry,
  options: SoftBodyOptions,
  position: number[],
  quaternion = [0, 0, 0, 1],
) {
  const settings = softSettings(options);
  const record = softBodyOf(geometry, { x: 1, y: 1, z: 1 }, settings);
  writeSoft(writer, {
    ...{ id: id(slot), position, quaternion, scale: [1, 1, 1] },
    ...{ friction: 0.5, restitution: 0, gravityScale: 1, linearDamping: 0.05 },
    ...{ settings, record },
  });
}

/**
 * A scene of every body kind a pin's long range attachment leaves as it was — boxes piling up
 * with their contact events, an unpinned cloth falling on them, a cloth given stretch hanging from
 * its pins, a rope swinging from its pin, a volume bouncing — stepped `steps` times at 60 Hz: the SHA-256 of every step's pose, event and
 * soft-vertex words, in order. Two modules that simulate it alike give the same hash.
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
  const hash = createHash('sha256');
  let posed = jolt.step(writer.take(), 0);
  for (let s = 0; s < steps; s++) {
    hash.update(jolt.poses(posed)).update(jolt.events()).update(jolt.soft());
    posed = jolt.step(null, 1 / 60);
  }
  return hash.digest('hex');
}
