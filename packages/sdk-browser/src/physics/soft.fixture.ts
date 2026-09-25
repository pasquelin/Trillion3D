import {
  BODY_INDEX,
  CommandWriter,
  FLAG,
  POSE_WORDS,
  SOFT_STATE_WORDS,
  softBodyOf,
  writeSoft,
  type SoftBodyOptions,
  type SoftBodyRecord,
} from '../../../sdk-core/src/physics/index.ts';
import { softSettings } from '../../../sdk-core/src/physics/soft.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { fromArrays } from '../../../sdk-core/src/world/geometry/builder.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import { body, startModule, type Module } from './module.fixture.ts';

/** A box of `mass` kg and 0.2 m in slot 2, its centre at `y`, with `flags`. */
export function addBox(jolt: Module, mass: number, y: number, flags = 0) {
  const writer = new CommandWriter();
  writer.add({ ...body(2 | (1 << 24), 2, y, 0.1, flags), mass });
  jolt.step(writer.take(), 0);
}

/** Steps once; the height of the box in slot 2 when the step sent its pose, else `last`. */
export function stepBox(jolt: Module, last: number) {
  const count = jolt.step(null, 1 / 60),
    poses = new Float32Array(jolt.poses(count).slice().buffer);
  for (let r = 0; r < count; r++)
    if ((new Uint32Array(poses.buffer)[r * POSE_WORDS] & BODY_INDEX) === 2)
      return poses[r * POSE_WORDS + 2];
  return last;
}

/** Laid flat: the plane's `+y` turned to the world's `−z`, so its `−z` is the world's down. */
export const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/** A committed module with Earth's gravity and a floor in slot 0, its top at y = 0, turned by
 *  `quaternion` about its centre. */
export async function softWorld(quaternion = [0, 0, 0, 1]) {
  const jolt = await startModule();
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add({ ...body(1 << 24, 0, -1, 1), size: [20, 1, 20], quaternion });
  jolt.step(writer.take(), 0);
  return jolt;
}

/** Adds `geometry` as a soft body in slot 1, at `position`; `words` override the record's. */
export function addSoft(
  jolt: Module,
  geometry: Geometry,
  options: SoftBodyOptions,
  position: number[],
  words: Partial<SoftBodyRecord> = {},
) {
  const settings = softSettings(options);
  const record = softBodyOf(geometry, { x: 1, y: 1, z: 1 }, settings);
  const writer = new CommandWriter();
  writeSoft(writer, {
    ...{ id: 1 | (1 << 24), position, quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    ...{ friction: 0.5, restitution: 0, gravityScale: 1, linearDamping: 0.05 },
    ...{ settings, record, ...words },
  });
  jolt.step(writer.take(), 0);
  return record;
}

/** Steps `seconds`, then the soft body's vertices as the page hears them, per geometry vertex. */
export function settle(jolt: Module, record: { map: Uint32Array }, seconds: number) {
  let last: Float32Array | null = null;
  for (let s = 0; s < seconds * 60; s++) {
    jolt.step(null, 1 / 60);
    const words = jolt.soft();
    if (words.length) last = new Float32Array(words.slice(SOFT_STATE_WORDS).buffer);
  }
  const out = new Float32Array(record.map.length * 3);
  record.map.forEach((v, i) => out.set(last!.subarray(v * 3, v * 3 + 3), i * 3));
  return out;
}

/** A rope of `count` points along x from the origin, `length` long. */
export const ropeLine = (count: number, length: number) =>
  fromArrays(
    Array.from({ length: count }, (_, i) => [(i * length) / (count - 1), 0, 0]).flat(),
    [],
    [],
    [],
  );

/** The vertex `v` of `vertices`. */
export const at = (vertices: Float32Array, v: number) => [...vertices.subarray(v * 3, v * 3 + 3)];

/** A 1 m cloth of 10 × 10 squares laid flat at `y` in slot 1, `pins` held, its events wanted when
 *  told. */
export function flatCloth(jolt: Module, y: number, pins: number[], events = false) {
  const record = addSoft(jolt, plane(1, 1, 10, 10), { type: 'cloth', pins }, [0, y, 0], {
    quaternion: FLAT,
  });
  const writer = new CommandWriter();
  if (events) writer.flags(1, FLAG.events);
  jolt.step(writer.take(), 0);
  return record;
}
