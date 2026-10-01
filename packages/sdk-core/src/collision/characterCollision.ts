import { capsulePass, type Capsule, type CapsuleContact, type CapsulePush } from './capsule.ts';
import { dropSphere } from './drop.ts';
import { forEachTriangleInBox } from './triangleQuery.ts';
import type { TriangleTree } from './triangleTree.ts';

/**
 * THE SEAM BETWEEN A CHARACTER AND THE WORLD IT COLLIDES WITH. The character body
 * (`characterBody.ts`) never reads triangles: it moves its capsule in parts shorter than its
 * radius and, after each, asks what the capsule overlaps and which way out; and a walker asks
 * where the floor under its feet is. Everything else — speed, gravity, steps, slopes, jumps —
 * is the body's own.
 *
 * The static triangle tree of `triangleCollision` implements it, and so may any world that
 * answers the two questions. A physics backend does not: it replaces the whole body through
 * `CharacterBodyFactory`, and its character meets the simulation's own bodies.
 */
export interface CharacterCollision {
  /**
   * Finds what `capsule` overlaps and calls `push(contact)` for each overlap, at once
   * (`CapsuleContact`: the way out, the surface, the touched point, the depth). `push` moves
   * `capsule.feet`; an implementation measures each next overlap from the moved capsule, so a
   * corner is left in one call. Returns whether anything overlapped.
   */
  resolveCapsule(capsule: Capsule, push: CapsulePush): boolean;
  /**
   * Lowers the capsule's bottom sphere straight down, by at most `depth`, and returns how far
   * it goes before it first rests on a surface `accepts` takes — the highest such support;
   * negative when the capsule already sinks into it and must rise. `null` when there is none.
   * The sphere stops at the first surface on its way down: one `accepts` refuses, met first,
   * hides every support below it. `capsule.feet` is left where it was. `accepts` sees each
   * candidate touch as a contact: `point`, `normal` from the point to the sphere's centre,
   * `surface` the face turned up.
   */
  groundBelow(
    capsule: Capsule,
    depth: number,
    accepts: (contact: CapsuleContact) => boolean,
  ): number | null;
}

/** The default collision world: a static triangle tree. */
export interface TriangleCollision extends CharacterCollision {
  /** The tree answered from: its `triangleCount` and `bytes` are the world's cost. */
  readonly tree: TriangleTree;
}

const min = new Float64Array(3),
  max = new Float64Array(3),
  touch: CapsuleContact = {
    normal: new Float64Array(3),
    surface: new Float64Array(3),
    point: new Float64Array(3),
    depth: 0,
  };

/** A collision world over the triangles of `tree`. */
export function triangleCollision(tree: TriangleTree): TriangleCollision {
  return {
    tree,
    resolveCapsule: (capsule, push) => capsulePass(tree, capsule, push),
    groundBelow(capsule, depth, accepts) {
      const { feet, radius, height } = capsule;
      // The column the sphere sweeps, up to the top of the body: a support higher than the
      // body is a ceiling, not a floor.
      for (let k = 0; k < 3; k += 2) [min[k], max[k]] = [feet[k] - radius, feet[k] + radius];
      [min[1], max[1]] = [feet[1] - depth, feet[1] + Math.max(height, 2 * radius)];
      // The sphere stops at the first surface it meets on its way down, as the floor sweep of
      // Unreal's CharacterMovement (`FindFloor`, `StepUp`) and the stair walk of Jolt's
      // CharacterVirtual stop at their first hit: a surface `accepts` refuses — too steep, or
      // above a step — met on the way hides every support below it. One the sphere already
      // sinks into (a negative distance) is behind it, not on its way.
      let best = Infinity,
        blocked = Infinity;
      forEachTriangleInBox(tree, min, max, (at) => {
        // A sweep is the same from any point of its vertical line: lowered from the feet rather
        // than from `feet + radius`, which rounds, the sphere goes one radius further, and feet
        // put on a floor at any height are at distance 0, not a rounding above it.
        const distance = dropSphere(feet, radius, tree.triangles, at, touch) + radius;
        if (!(distance <= depth && distance < best && touch.normal[1] > 0)) return;
        if (accepts(touch)) best = Math.min(best, distance);
        else if (distance >= 0) blocked = Math.min(blocked, distance);
      });
      return best < Infinity && best <= blocked ? best : null;
    },
  };
}
