import { CommandWriter, FLAG, GENERATION_SHIFT } from '../../../sdk-core/src/physics/index.ts';
import { axisAngleQuaternion } from '../../../sdk-core/src/math/matrix/quaternion.ts';
import { plane, sphere } from '../../../sdk-core/src/world/geometry/basic.ts';
import type { JoltModule } from './joltModule.ts';
import { body } from './module.fixture.ts';
import { FLAT, GENERATION, ropeLine, writeSoftBody } from './soft.fixture.ts';

/**
 * How far a written-back vertex may stray from the per-vertex chain it replaced (PHY-06, #975):
 * four float spacings at 32 m, the reach of the soft tests' scenes (2⁻¹⁹ m each), 7.6 µm; a tenth
 * of a pixel is millimetres at any distance the page draws a soft body from.
 */
export const WRITEBACK_BOUND = 4 * 2 ** -19;

/** Generation 1 of slot `slot`'s engine id. */
const id = (slot: number) => slot | GENERATION;

/** The steps whose soft words `writebackScene` keeps: after each change of its list. */
const KEPT = new Set([1, 20, 21, 22, 35, 41, 46, 51, 56, 90]);

/** A turn of `angle` about the unit axis `x, y, z`, as `x, y, z, w`. */
const turn = (x: number, y: number, z: number, angle: number) =>
  Array.from(axisAngleQuaternion(new Float64Array(4), [x, y, z], angle));

/**
 * Soft bodies made scaled and turned, then one removed (the list compacts), others teleported,
 * one hidden and shown again, and a new one made in the freed slot and teleported: the soft words
 * of the steps `KEPT` names, copied, in order. Positions carry both zeros (#975).
 */
export function writebackScene(jolt: Pick<JoltModule, 'step' | 'soft'>) {
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add({ ...body(id(0), 0, -1, 1), size: [40, 1, 40] });
  writeSoftBody(writer, id(1), plane(1, 1, 6, 6), { type: 'cloth' }, [0, 2, 0], FLAT, {
    scale: [2, 1, 0.5],
  });
  writeSoftBody(
    writer,
    id(2),
    ropeLine(9, 1),
    { type: 'rope', pins: [0] },
    [3, 3, -0],
    turn(0, 0, 1, 0.7),
    { scale: [1.5, 1.5, 1.5] },
  );
  writeSoftBody(writer, id(3), sphere(0.3, 8, 6), { type: 'volume' }, [-3, 1.5, 0]);
  const pins = [20, 21, 22, 23, 24];
  writeSoftBody(
    writer,
    id(4),
    plane(1, 1, 4, 4),
    { type: 'cloth', pins },
    [-0, 3, 3],
    turn(0.6, 0, -0.8, 2),
  );
  const out: Uint32Array[] = [];
  let words = writer.take();
  for (let s = 0; s <= 90; s++) {
    jolt.step(words, s === 0 ? 0 : 1 / 60);
    if (KEPT.has(s)) out.push(jolt.soft().slice());
    if (s === 19) writer.remove(1);
    if (s === 20) writer.teleport(3, [25, 2, -0], turn(0, 1, 0, 1.2));
    if (s === 30) writer.flags(4, FLAG.hidden);
    if (s === 40) writer.flags(4, 0);
    if (s === 45) writer.teleport(2, [-0, 4, 10], [-0, -0, -0, 1]);
    if (s === 50)
      writeSoftBody(
        writer,
        1 | (2 << GENERATION_SHIFT),
        plane(1, 1, 3, 3),
        { type: 'cloth' },
        [5, 1, 5],
        turn(1, 0, 0, -0.4),
      );
    if (s === 55) writer.teleport(1, [-7, 2, 0], turn(0, 0, 1, 3));
    words = writer.take();
  }
  return out;
}

/** A seeded generator of numbers in [0, 1) (mulberry32): the same draws on every run. */
export function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
