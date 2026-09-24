import {
  ASLEEP_BIT,
  MAX_CATCH_UP_STEPS,
  PHYSICS_STEP,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { NODE_TRS_DIRTY } from '../../../sdk-core/src/math/transform-tree/transformTree.ts';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { Bodied } from './bodies.ts';

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
 * Every write is a flat one, straight into the node's position, quaternion and transform tree,
 * the world told once for the batch (`_link.posed`): no per-body listener runs.
 */
export function createPhysicsPoses(maxBodies: number) {
  const from = new Float32Array(maxBodies * 7),
    to = new Float32Array(maxBodies * 7),
    velocity = new Float32Array(maxBodies * 6);
  const moving = new Int32Array(maxBodies);
  const listed = new Uint8Array(maxBodies);
  let count = 0;
  /** Where each slot's mesh keeps its pose, bound when a record first names it. */
  const owner: (Bodied | null)[] = [];
  const position: Float64Array[] = [],
    quaternion: Float64Array[] = [];
  const node = new Int32Array(maxBodies);
  let start = 0,
    span = 0,
    arrived = -1,
    /** Simulated seconds per page millisecond, for the extrapolation. */
    rate = 0,
    awake = false;
  const bind = (index: number, mesh: Bodied) => {
    owner[index] = mesh;
    position[index] = mesh.position.elements;
    quaternion[index] = mesh.quaternion.elements;
    node[index] = mesh.index;
  };
  /** Writes slot `index` at `pose` (7 numbers from `at`), in the mesh and in its tree. */
  const place = (index: number, pose: ArrayLike<number>, at: number) => {
    const mesh = owner[index]!;
    const tree = Object3D._treeOf(mesh);
    const p = position[index],
      q = quaternion[index],
      n = node[index];
    const tp = tree.position,
      tq = tree.quaternion;
    tp[n * 3] = p[0] = pose[at];
    tp[n * 3 + 1] = p[1] = pose[at + 1];
    tp[n * 3 + 2] = p[2] = pose[at + 2];
    tq[n * 4] = q[0] = pose[at + 3];
    tq[n * 4 + 1] = q[1] = pose[at + 4];
    tq[n * 4 + 2] = q[2] = pose[at + 5];
    tq[n * 4 + 3] = q[3] = pose[at + 6];
    tree.flags[n] |= NODE_TRS_DIRTY;
    if (mesh._link) placed.push(mesh);
  };
  let placed: Bodied[] = [];
  const tell = () => {
    // Every body hangs in the one scene: its link hears the whole batch at once, and reads the
    // list before the next frame, which gets a fresh one.
    if (placed.length) placed[0]._link!.posed(placed);
    placed = [];
  };
  const pose = new Float32Array(7);
  return {
    /**
     * A tick's pose records arrived, simulating `ms` of the page's time; returns how many moved a
     * body from where it is drawn (a pose sent again unchanged asks for no frame). A decorative
     * body that fell asleep is placed at its last pose at once and handed to `rest`, which takes
     * it out of the simulation.
     */
    receive(
      words: Uint32Array,
      records: number,
      meshes: (Bodied | null)[],
      ms: number,
      rest: (index: number) => void,
    ) {
      const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
      const now = performance.now();
      const interval = arrived < 0 ? ms : now - arrived;
      arrived = now;
      // A first tick, or one after a rest, is drawn over the time it simulates.
      span = ms <= 0 ? 0 : interval > LONGEST_MS ? ms : span > 0 ? span * 0.7 + interval * 0.3 : ms;
      rate = span > 0 ? ms / span / 1000 : 0;
      let moved = 0;
      awake = false;
      for (let r = 0; r < records; r++) {
        const at = r * POSE_WORDS,
          index = (words[at] & ~ASLEEP_BIT) >>> 0,
          mesh = meshes[index];
        if (!mesh) continue;
        if (owner[index] !== mesh) bind(index, mesh);
        const physics = mesh.physics,
          asleep = (words[at] & ASLEEP_BIT) !== 0;
        physics.asleep = asleep;
        const linear = physics.velocity.elements;
        linear[0] = floats[at + 8];
        linear[1] = floats[at + 9];
        linear[2] = floats[at + 10];
        if (asleep && physics.decorative) {
          place(index, floats, at + 1);
          // Off the moving list: the slot may hold another body before the list is drawn.
          listed[index] = 0;
          rest(index);
          moved++;
          continue;
        }
        const p = position[index],
          q = quaternion[index],
          o = index * 7;
        const dot =
          q[0] * floats[at + 4] +
          q[1] * floats[at + 5] +
          q[2] * floats[at + 6] +
          q[3] * floats[at + 7];
        const same = p[0] === floats[at + 1] && p[1] === floats[at + 2] && p[2] === floats[at + 3];
        if (same && Math.abs(dot) >= 1 - 1e-6 && !listed[index]) continue;
        moved++;
        from.set(p, o);
        from.set(q, o + 3);
        for (let k = 0; k < 7; k++) to[o + k] = floats[at + 1 + k];
        // The shorter way round: a quaternion and its opposite are one rotation.
        if (dot < 0) for (let k = 3; k < 7; k++) to[o + k] = -to[o + k];
        // An asleep body is not extrapolated.
        for (let k = 0; k < 6; k++) velocity[index * 6 + k] = asleep ? 0 : floats[at + 8 + k];
        awake ||= !asleep;
        if (!listed[index]) moving[count++] = index;
        listed[index] = 1;
      }
      tell();
      start = now;
      return moved;
    },
    /** Draws every moving body at this frame's point; whether any is still on its way (and asks
     *  for the next frame). */
    apply(meshes: readonly (Bodied | null)[]) {
      if (!count) return false;
      const elapsed = performance.now() - start;
      const alpha = span > 0 ? Math.min(1, elapsed / span) : 1;
      // Past the target, a late tick is extrapolated, for one interval at most.
      const ahead = awake ? Math.min(Math.max(0, elapsed - span), span) * rate : 0;
      for (let i = 0; i < count; i++) {
        const index = moving[i];
        // A slot whose body left, or went to another mesh, waits for that mesh's own record.
        if (!listed[index] || meshes[index] !== owner[index]) continue;
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
        const n = Math.hypot(pose[3], pose[4], pose[5], pose[6]) || 1;
        for (let k = 3; k < 7; k++) pose[k] /= n;
        place(index, pose, 0);
      }
      tell();
      if (alpha < 1 || (awake && elapsed < 2 * span)) return true;
      for (let i = 0; i < count; i++) listed[moving[i]] = 0;
      count = 0;
      return false;
    },
  };
}
