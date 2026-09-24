import type { WaterSpec } from '../../../sdk-core/src/fluids/index.ts';
import {
  CommandWriter,
  LAYER,
  MOTION,
  POSE_WORDS,
  SHAPE,
  type BodyRecord,
  type CompoundPart,
} from '../../../sdk-core/src/physics/index.ts';
import type { JoltModule } from './joltModule.ts';
import { createWaterStep } from './water.ts';

const TURN = [0, 0, 0, 1];
/** A dynamic body for the ADD command: engine id `id` (generation 1), at `position`. */
export function floater(
  id: number,
  position: number[],
  density: number,
  shape: Pick<BodyRecord, 'shape' | 'size' | 'parts'>,
): BodyRecord {
  return {
    id: id | (1 << 24),
    motion: MOTION.dynamic,
    layer: LAYER.moving,
    flags: 0,
    position,
    quaternion: TURN,
    mass: 0,
    density,
    friction: 0.5,
    restitution: 0,
    gravityScale: 1,
    ...shape,
  };
}

/** A cube of half side `half`. */
export const cube = (half: number) => ({ shape: SHAPE.box, size: [half, half, half] as const });
/** A raft: two pontoons under a deck, one compound body. */
export const raft = () => {
  const part = (y: number, z: number, size: CompoundPart['size']): CompoundPart => ({
    shape: SHAPE.box,
    size,
    position: [0, y, z],
    quaternion: TURN,
  });
  const parts = [
    part(-0.2, -1, [1.5, 0.25, 0.3]),
    part(-0.2, 1, [1.5, 0.25, 0.3]),
    part(0.15, 0, [1.5, 0.05, 1.3]),
  ];
  return { shape: SHAPE.compound, size: [0, 0, 0] as const, parts };
};

/**
 * The fluids bench's floating scene: `count` bodies on a grid 6 m apart, at the water's rest
 * height: wooden cubes, with every tenth a 10 m plank (sliced), a raft (compound) or a cork ball.
 */
export function floatingScene(count: number) {
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const at = [(i % side) * 6, 0.2, Math.floor(i / side) * 6];
    const kind = i % 10;
    const shape =
      kind === 7
        ? { shape: SHAPE.box, size: [5, 0.2, 0.5] as const }
        : kind === 8
          ? raft()
          : kind === 9
            ? { shape: SHAPE.sphere, size: [0.5, 0, 0] as const }
            : cube(0.5);
    writer.add(floater(i, at, kind === 9 ? 250 : 600, shape));
  }
  return writer.take();
}

/**
 * Steps `jolt` `steps` times at 60 Hz in `water`, after `scene`; returns each body slot's last
 * pose words and the milliseconds of every step.
 */
export function runWater(jolt: JoltModule, water: WaterSpec, scene: Uint32Array, steps: number) {
  const step = createWaterStep();
  step.set(water);
  jolt.step(scene, 0);
  const last = new Map<number, number[]>();
  const ms: number[] = [];
  for (let s = 0; s < steps; s++) {
    const t = performance.now();
    const count = step.step(jolt, null, 1 / 60);
    ms.push(performance.now() - t);
    const words = jolt.poses(count);
    for (let r = 0; r < count; r++) {
      const record = Array.from(words.subarray(r * POSE_WORDS, (r + 1) * POSE_WORDS));
      last.set(record[0] & 0x00ffffff, record);
    }
  }
  return { last, ms };
}
