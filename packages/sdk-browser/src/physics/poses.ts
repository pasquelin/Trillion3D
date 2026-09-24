import { ASLEEP_BIT, POSE_WORDS } from '../../../sdk-core/src/physics/index.ts';
import type { Bodied } from './bodies.ts';

/**
 * The drawn poses of the moving bodies, between two worker ticks. Each tick's record becomes the
 * target; the start is the pose drawn when it arrived, so the image never jumps back. The frame
 * draws the pose `alpha` of the way there, `alpha` being the share of the tick's simulated time
 * that has passed on the page's clock. Once there, nothing moves until the next tick: a world
 * whose bodies all sleep sends no tick, and the page draws nothing more.
 */
export function createPhysicsPoses(maxBodies: number) {
  const from = new Float32Array(maxBodies * 7),
    to = new Float32Array(maxBodies * 7);
  const moving: number[] = [];
  const listed = new Uint8Array(maxBodies);
  let start = 0,
    span = 1;
  /** Set while the engine writes a pose: the scene link must not read it as the page's move. */
  let writing = false;
  const pose = new Float32Array(7);
  const write = (mesh: Bodied) => {
    const e = mesh.position.elements;
    e[0] = pose[0];
    e[1] = pose[1];
    e[2] = pose[2];
    mesh.setPosition(e[0], e[1], e[2]);
    // The rotation write tells the world the node moved, once for both.
    mesh.quaternion.set(pose[3], pose[4], pose[5], pose[6]);
  };
  return {
    get writing() {
      return writing;
    },
    /** A tick's pose records arrived, covering `ms` of the page's time; returns how many moved
     *  a body from where it is drawn (a pose sent again unchanged asks for no frame). */
    receive(words: Uint32Array, count: number, meshes: (Bodied | null)[], ms: number) {
      const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
      let moved = 0;
      for (let r = 0; r < count; r++) {
        const at = r * POSE_WORDS,
          index = (words[at] & ~ASLEEP_BIT) >>> 0,
          mesh = meshes[index];
        if (!mesh) continue;
        const o = index * 7,
          p = mesh.position.elements,
          q = mesh.quaternion;
        const physics = mesh.physics;
        physics.asleep = (words[at] & ASLEEP_BIT) !== 0;
        physics._quiet = true;
        physics.velocity.set(floats[at + 8], floats[at + 9], floats[at + 10]);
        physics._quiet = false;
        const same =
          p[0] === floats[at + 1] &&
          p[1] === floats[at + 2] &&
          p[2] === floats[at + 3] &&
          Math.abs(
            q.x * floats[at + 4] +
              q.y * floats[at + 5] +
              q.z * floats[at + 6] +
              q.w * floats[at + 7],
          ) >=
            1 - 1e-6;
        if (same && !listed[index]) continue;
        moved++;
        from[o] = p[0];
        from[o + 1] = p[1];
        from[o + 2] = p[2];
        from[o + 3] = q.x;
        from[o + 4] = q.y;
        from[o + 5] = q.z;
        from[o + 6] = q.w;
        to.set(floats.subarray(at + 1, at + 8), o);
        // The shorter way round: a quaternion and its opposite are one rotation.
        if (q.x * to[o + 3] + q.y * to[o + 4] + q.z * to[o + 5] + q.w * to[o + 6] < 0)
          for (let k = 3; k < 7; k++) to[o + k] = -to[o + k];
        if (!listed[index]) moving.push(index);
        listed[index] = 1;
      }
      start = performance.now();
      span = ms;
      return moved;
    },
    /** Draws every moving body at this frame's point between its two poses; whether any is
     *  still on its way, and asks for the next frame. */
    apply(meshes: (Bodied | null)[]) {
      if (!moving.length) return false;
      const alpha = span > 0 ? Math.min(1, (performance.now() - start) / span) : 1;
      writing = true;
      for (const index of moving) {
        const mesh = meshes[index];
        if (!mesh) continue;
        const o = index * 7;
        // The last frame lands on the record exactly: a pose sent again is then seen unchanged.
        if (alpha === 1) pose.set(to.subarray(o, o + 7));
        else {
          for (let k = 0; k < 7; k++) pose[k] = from[o + k] + (to[o + k] - from[o + k]) * alpha;
          const n = Math.hypot(pose[3], pose[4], pose[5], pose[6]) || 1;
          for (let k = 3; k < 7; k++) pose[k] /= n;
        }
        write(mesh);
      }
      writing = false;
      if (alpha < 1) return true;
      for (const index of moving) listed[index] = 0;
      moving.length = 0;
      return false;
    },
  };
}
