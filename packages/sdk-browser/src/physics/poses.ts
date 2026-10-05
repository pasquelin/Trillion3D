import {
  ASLEEP_BIT,
  BODY_INDEX,
  GENERATION_SHIFT,
  GENERATIONS,
  PHYSICS_STEP,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { slerpArc } from '../../../sdk-core/src/math/matrix/quaternion.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { Bodied } from './bodies.ts';
import type { NodeMove } from './cookedBodies.ts';
import { extrapolateAll, interpolateAll, landAll } from './drawnPoses.ts';
import { createPosePlacer } from './placer.ts';
import { beforesAt, keptBefore } from './protocol.ts';
import { createTwoSteps, FROM } from './twoSteps.ts';

/** The bodies a tick's records name, by slot: meshes, moved compiled nodes, generations. */
export interface PosedBodies {
  readonly meshes: readonly (Bodied | null)[];
  readonly nested: ReadonlyMap<number, NodeMove>;
  readonly generation: Uint8Array;
  retire(index: number): void;
}

/** Copies the 7 numbers of a pose (`x, y, z`, then the turn) from `src` at `s` into `into` at `o`. */
function copyPose(into: Float32Array, o: number, src: ArrayLike<number>, s: number) {
  for (let k = 0; k < 7; k++) into[o + k] = src[s + k];
}

/**
 * The drawn poses of the moving bodies. A frame draws each body at the frame's time, the fraction
 * `t` of a step the session reads once for everything the physics draws (`along`), between its
 * two states (`twoSteps.ts`): the newest record a tick brought, and its state a step before — its
 * earlier pose in that tick (`tickResults.ts`), else its record before, else the pose it is drawn
 * at, at rest. Places are drawn on the line between the two, as a step moves a body, turns on the
 * arc between them, as a step turns it; the same frames draw the same poses, whenever the ticks
 * came. A time past the newest state — the worker is late — is drawn moved on from it by each
 * body's velocity (none asleep), a ceiling of catch-up steps at most, while the page waits for
 * that state: once it comes, the body is on its simulated trajectory again. Nothing is drawn once
 * there: a world whose bodies all sleep sends no tick.
 *
 * Every write is a flat one (`placer.ts`): the node's position, quaternion and transform tree,
 * and the world matrix straight into the row the renderer reads; no per-body listener runs.
 */
export function createPhysicsPoses(maxBodies: number, root: Object3D, step = PHYSICS_STEP) {
  /** Each slot's state a step before the newest, and its newest (7 numbers a slot), and the arc
   *  between their turns (`slerpArc`, 3 a slot). */
  const from = new Float32Array(maxBodies * 7),
    to = new Float32Array(maxBodies * 7),
    arcs = new Float64Array(maxBodies * 3);
  /** The bodies' last step (`ObjectPhysics._state`): what `physics.velocity` and `asleep` read. */
  const state = {
    asleep: new Uint8Array(maxBodies),
    velocity: new Float32Array(maxBodies * 6),
    stamp: new Uint32Array(maxBodies),
  };
  const { velocity, asleep: sleeping, stamp } = state;
  const decorative = new Uint8Array(maxBodies);
  const befores = beforesAt({ bodies: maxBodies });
  /** The slots on their way, and the tick that last wrote each (`state.stamp`). */
  const steps2 = createTwoSteps(maxBodies);
  let tick = 0;
  const placer = createPosePlacer(maxBodies, root);
  const { bound, place, position, quaternion } = placer;
  /** Whether the record at `at` holds the pose slot `index` is drawn at (the turn up to sign). */
  const unchanged = (index: number, floats: Float32Array, at: number) => {
    const p = index * 3,
      q = index * 4;
    const dot =
      quaternion[q] * floats[at + 4] +
      quaternion[q + 1] * floats[at + 5] +
      quaternion[q + 2] * floats[at + 6] +
      quaternion[q + 3] * floats[at + 7];
    return (
      position[p] === floats[at + 1] &&
      position[p + 1] === floats[at + 2] &&
      position[p + 2] === floats[at + 3] &&
      Math.abs(dot) >= 1 - 1e-6
    );
  };
  /** Whether slot `index`'s newest state is the pose the record at `at` holds. */
  const holds = (index: number, floats: Float32Array, at: number) => {
    for (let k = 0; k < 7; k++) if (to[index * 7 + k] !== floats[at + 1 + k]) return false;
    return true;
  };
  /** Copies the pose slot `index` is drawn at into `into`, 7 numbers a slot. */
  const drawnInto = (into: Float32Array, index: number) => {
    copyPose(into, index * 7, position, index * 3);
    for (let k = 0; k < 4; k++) into[index * 7 + 3 + k] = quaternion[index * 4 + k];
  };
  /** Slot `index` holds where it is drawn now, until its body's next tick. */
  const hold = (index: number) => {
    drawnInto(to, index);
    copyPose(from, index * 7, to, index * 7);
    slerpArc(arcs, index * 3, from, index * 7 + 3, to, index * 7 + 3);
  };
  return {
    state,
    /** Every mesh keeps its own pose numbers again (the physics stops). */
    clear: placer.clear,
    /** The page moved `node`: a compiled node posed under it is drawn where it now stands. */
    follow: (node: Object3D) => placer.follow(node, hold),
    /**
     * A tick's pose records arrived, after `steps` fixed steps; returns how many moved a body from
     * where it is drawn (a pose sent again unchanged asks for no frame). A tick of no step —
     * commands run while paused, or before a query — moved its bodies in place: those it moved
     * are drawn there at once. A record of a body that left its slot is skipped. A decorative body
     * that fell asleep is placed at its last pose at once and retired, out of the simulation.
     * Typed arrays only, but for a mesh met for the first time in its slot.
     */
    receive(words: Uint32Array, records: number, bodies: PosedBodies, steps: number) {
      const { generation, meshes, nested } = bodies;
      const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
      let moved = 0;
      tick++;
      steps2.begin(steps);
      placer.begin();
      for (let r = 0; r < records; r++) {
        const at = r * POSE_WORDS,
          head = words[at],
          index = head & BODY_INDEX,
          g = generation[index],
          mesh = meshes[index],
          made = mesh ? undefined : nested.get(index);
        // A body that left its slot, or a model's moving no node (`bodySlots.ts`), draws nothing.
        if (g !== (head >>> GENERATION_SHIFT) % GENERATIONS || !(mesh || made)) continue;
        // A body new to its slot starts from its own pose, whatever the slot listed before it.
        const fresh = bound[index] !== g;
        if (fresh) {
          if (mesh) placer.bind(index, g, mesh);
          else if (made) placer.bindNode(index, g, made.node, made.scale);
          decorative[index] = mesh?.physics.decorative ? 1 : 0;
        }
        const asleep = (head & ASLEEP_BIT) !== 0,
          v = index * 6;
        sleeping[index] = asleep ? 1 : 0;
        stamp[index] = tick;
        // An asleep body is not extrapolated.
        const moves = asleep ? 0 : 1;
        for (let k = 0; k < 6; k++) velocity[v + k] = floats[at + 8 + k] * moves;
        if (asleep && decorative[index]) {
          place(index, floats, at + 1);
          // Its generation moves on: the next frame takes it off the moving list, and a body
          // that takes the slot before then is listed once, not twice.
          bodies.retire(index);
          moved++;
          continue;
        }
        // A listed body is on its way: its record is its next state, whatever it holds.
        if (!steps2.listed(index) && unchanged(index, floats, at)) continue;
        const o = index * 7,
          before = befores + at,
          same = steps === 0 && !fresh && holds(index, floats, at),
          earlier = steps2.take(index, keptBefore(head, words[before]), fresh, same);
        if (earlier === FROM.kept) continue;
        moved++;
        if (earlier === FROM.newest) copyPose(from, o, floats, at + 1);
        else if (earlier === FROM.before) copyPose(from, o, floats, before + 1);
        else if (earlier === FROM.last) copyPose(from, o, to, o);
        else drawnInto(from, index);
        copyPose(to, o, floats, at + 1);
        slerpArc(arcs, index * 3, from, o + 3, to, o + 3);
      }
      steps2.end((index) => {
        if (bound[index] === generation[index]) place(index, to, index * 7);
      });
      placer.end();
      return moved;
    },
    /** Draws every moving body at `t` of its step (`along`), `waiting` while the page waits for
     *  the worker's next state; whether any is still on its way (and asks for the next frame). */
    apply({ generation }: PosedBodies, t: number, waiting: boolean) {
      if (!steps2.count) return false;
      // A slot whose body left, or went to another mesh, leaves the list: it waits for that
      // mesh's own record, which lists it again. The rest is drawn in one pass.
      steps2.keep((index) => bound[index] === generation[index]);
      const { moving, count } = steps2;
      placer.begin();
      // Between the two states; else on the newest, or moved on from it by its velocities while
      // it is late.
      if (t < 1) interpolateAll(moving, count, from, to, arcs, t, position, quaternion);
      else if (t > 1)
        extrapolateAll(moving, count, to, velocity, (t - 1) * step, position, quaternion);
      else landAll(moving, count, to, position, quaternion);
      placer.commit(moving, count);
      placer.end();
      return steps2.settle(t, waiting);
    },
  };
}
