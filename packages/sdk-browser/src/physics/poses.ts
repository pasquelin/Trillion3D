import {
  ASLEEP_BIT,
  BODY_INDEX,
  GENERATION_SHIFT,
  GENERATIONS,
  MAX_CATCH_UP_STEPS,
  PHYSICS_STEP,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { Bodied } from './bodies.ts';
import { createPosePlacer } from './placer.ts';

/** The bodies a tick's records name: meshes and generations by slot, and the way out of one. */
export interface PosedBodies {
  readonly meshes: readonly (Bodied | null)[];
  readonly generation: Uint8Array;
  retire(index: number): void;
}

/** Longest a tick may be drawn over, and longest a late one is extrapolated: the catch-up ceiling. */
const LONGEST_MS = MAX_CATCH_UP_STEPS * PHYSICS_STEP * 1000;

/**
 * The drawn poses of the moving bodies, between two worker ticks. Each tick's record becomes the
 * target; the start is the pose drawn when it arrived, so the image never jumps back. A tick is
 * drawn over the interval at which ticks arrive (smoothed), not over the time it simulates: a
 * worker slower than the display then shows smooth slow motion, never a pose held while it is
 * late. Past the target, a late tick is extrapolated from the bodies' velocities, for one
 * interval at most. Nothing is drawn once there: a world whose bodies all sleep sends no tick.
 *
 * Every write is a flat one (`placer.ts`): the node's position, quaternion and transform tree,
 * and the world matrix straight into the row the renderer reads; no per-body listener runs.
 */
export function createPhysicsPoses(maxBodies: number, root: Object3D) {
  const from = new Float32Array(maxBodies * 7),
    to = new Float32Array(maxBodies * 7);
  /** The bodies' last step (`PhysicsState`): what `physics.velocity` and `asleep` read. */
  const state = {
    asleep: new Uint8Array(maxBodies),
    velocity: new Float32Array(maxBodies * 6),
    stamp: new Uint32Array(maxBodies),
  };
  const { velocity, asleep: sleeping, stamp } = state;
  const moving = new Int32Array(maxBodies);
  const listed = new Uint8Array(maxBodies),
    decorative = new Uint8Array(maxBodies);
  let count = 0,
    tick = 0;
  const placer = createPosePlacer(maxBodies, root);
  const { bound, place, position, quaternion } = placer;
  let start = 0,
    span = 0,
    arrived = -1,
    /** Simulated seconds per page millisecond, for the extrapolation. */
    rate = 0,
    awake = false;
  const pose = new Float32Array(7);
  return {
    state,
    /** Every mesh keeps its own pose numbers again (the physics stops). */
    clear: placer.clear,
    /**
     * A tick's pose records arrived, simulating `ms` of the page's time; returns how many moved a
     * body from where it is drawn (a pose sent again unchanged asks for no frame). A record of a
     * body that left its slot is skipped. A decorative body that fell asleep is placed at its
     * last pose at once and retired, out of the simulation. Typed arrays only, but for a mesh
     * met for the first time in its slot.
     */
    receive(words: Uint32Array, records: number, bodies: PosedBodies, ms: number) {
      const { generation } = bodies;
      const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
      const now = performance.now();
      const interval = arrived < 0 ? ms : now - arrived;
      arrived = now;
      // A first tick, or one after a rest, is drawn over the time it simulates.
      span = ms <= 0 ? 0 : interval > LONGEST_MS ? ms : span > 0 ? span * 0.7 + interval * 0.3 : ms;
      rate = span > 0 ? ms / span / 1000 : 0;
      let moved = 0;
      awake = false;
      tick++;
      placer.begin();
      for (let r = 0; r < records; r++) {
        const at = r * POSE_WORDS,
          index = words[at] & BODY_INDEX,
          g = generation[index];
        if (g !== (words[at] >>> GENERATION_SHIFT) % GENERATIONS) continue;
        if (bound[index] !== g) {
          const mesh = bodies.meshes[index]!;
          placer.bind(index, g, mesh);
          decorative[index] = mesh.physics.decorative ? 1 : 0;
        }
        const asleep = (words[at] & ASLEEP_BIT) !== 0,
          v = index * 6;
        sleeping[index] = asleep ? 1 : 0;
        stamp[index] = tick;
        // An asleep body is not extrapolated.
        for (let k = 0; k < 6; k++) velocity[v + k] = asleep ? 0 : floats[at + 8 + k];
        if (asleep && decorative[index]) {
          place(index, floats, at + 1);
          // Off the moving list: the slot may hold another body before the list is drawn.
          listed[index] = 0;
          bodies.retire(index);
          moved++;
          continue;
        }
        const p = index * 3,
          q = index * 4,
          o = index * 7;
        const dot =
          quaternion[q] * floats[at + 4] +
          quaternion[q + 1] * floats[at + 5] +
          quaternion[q + 2] * floats[at + 6] +
          quaternion[q + 3] * floats[at + 7];
        const same =
          position[p] === floats[at + 1] &&
          position[p + 1] === floats[at + 2] &&
          position[p + 2] === floats[at + 3];
        if (same && Math.abs(dot) >= 1 - 1e-6 && !listed[index]) continue;
        moved++;
        for (let k = 0; k < 3; k++) from[o + k] = position[p + k];
        for (let k = 0; k < 4; k++) from[o + 3 + k] = quaternion[q + k];
        for (let k = 0; k < 7; k++) to[o + k] = floats[at + 1 + k];
        // The shorter way round: a quaternion and its opposite are one rotation.
        if (dot < 0) for (let k = 3; k < 7; k++) to[o + k] = -to[o + k];
        awake ||= !asleep;
        if (!listed[index]) moving[count++] = index;
        listed[index] = 1;
      }
      placer.end();
      start = now;
      return moved;
    },
    /** Draws every moving body at this frame's point; whether any is still on its way (and asks
     *  for the next frame). */
    apply({ generation }: PosedBodies) {
      if (!count) return false;
      const elapsed = performance.now() - start;
      const alpha = span > 0 ? Math.min(1, elapsed / span) : 1;
      // Past the target, a late tick is extrapolated, for one interval at most.
      const ahead = awake ? Math.min(Math.max(0, elapsed - span), span) * rate : 0;
      placer.begin();
      for (let i = 0; i < count; i++) {
        const index = moving[i];
        // A slot whose body left, or went to another mesh, waits for that mesh's own record.
        if (!listed[index] || bound[index] !== generation[index]) continue;
        const o = index * 7,
          v = index * 6;
        // The frame at the target lands on the record exactly: sent again, it is seen unchanged.
        if (alpha === 1 && ahead === 0) {
          place(index, to, o);
          continue;
        }
        for (let k = 0; k < 7; k++) pose[k] = from[o + k] + (to[o + k] - from[o + k]) * alpha;
        for (let k = 0; k < 3; k++) pose[k] += velocity[v + k] * ahead;
        // The turn at angular velocity ω over `ahead`: q += ½ (ω, 0) ⊗ q · ahead.
        const wx = velocity[v + 3],
          wy = velocity[v + 4],
          wz = velocity[v + 5];
        const x = pose[3],
          y = pose[4],
          z = pose[5],
          w = pose[6],
          h = ahead / 2;
        pose[3] += h * (wx * w + wy * z - wz * y);
        pose[4] += h * (wy * w + wz * x - wx * z);
        pose[5] += h * (wz * w + wx * y - wy * x);
        pose[6] -= h * (wx * x + wy * y + wz * z);
        const n =
          Math.sqrt(
            pose[3] * pose[3] + pose[4] * pose[4] + pose[5] * pose[5] + pose[6] * pose[6],
          ) || 1;
        for (let k = 3; k < 7; k++) pose[k] /= n;
        place(index, pose, 0);
      }
      placer.end();
      if (alpha < 1 || (awake && elapsed < 2 * span)) return true;
      for (let i = 0; i < count; i++) listed[moving[i]] = 0;
      count = 0;
      return false;
    },
  };
}
