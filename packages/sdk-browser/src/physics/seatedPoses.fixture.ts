/** Seated crates and the pose records of their ticks, for the tests of the drawn poses. */
import { ASLEEP_BIT, ObjectPhysics, POSE_WORDS } from '../../../sdk-core/src/physics/index.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import type { Bodied } from './bodies.ts';
import { poseRecord } from './worker.fixture.ts';

/** `count` seated crates in slots 0.., their rows in one batch, and the frames' `placed` calls. */
export function seated(count: number) {
  const scene = new Group();
  const batch = { rows: { matrices: new Float64Array(16 * count) } };
  const placed: number[] = [];
  scene._link = {
    pose() {},
    posed() {},
    structure() {},
    content() {},
    seatEpoch: () => 0,
    seat: (node) => ({ batch, row: meshes.indexOf(node as Bodied) }),
    placed: (_, from, to) => placed.push(to - from + 1),
  };
  const meshes = Array.from({ length: count }, () => {
    const crate = new Mesh(box()) as Bodied;
    crate.physics = new ObjectPhysics('dynamic');
    crate._link = scene._link;
    scene.add(crate);
    return crate;
  });
  const bodies = { meshes, slots: { nested: [] }, generation: new Uint8Array(count), retire() {} };
  return { scene, batch, placed, meshes, bodies };
}

/** A tick's records: slot `i` at height `y + i`, turning, moving at `v` m/s up (asleep: `sleep`). */
export function records(count: number, y: number, v: number, sleep = false) {
  const words = new Uint32Array(count * POSE_WORDS);
  for (let i = 0; i < count; i++) {
    const pose = [i, y + i, 0, 0, Math.sin(y / 4), 0, Math.cos(y / 4), 0, v, 0, 0, 0.5, 0];
    words.set(poseRecord(i | (sleep ? ASLEEP_BIT : 0), pose), i * POSE_WORDS);
  }
  return words;
}
