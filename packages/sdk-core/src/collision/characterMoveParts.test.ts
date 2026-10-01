import test from 'node:test';
import assert from 'node:assert/strict';
import { freshReport, slide } from './characterMove.ts';
import type { CapsuleContact } from './capsule.ts';
import { MOVE_PASSES } from './characterSettings.ts';
import { triangleCollision } from './characterCollision.ts';
import { buildTriangleTree } from './triangleTree.ts';
import { near } from '../math/near.fixture.ts';

const rules = { maxSlope: Math.PI / 4, onGround: false, stepTop: 1 };

test('a long movement cannot tunnel across a thin triangle wall and keeps tangential travel', () => {
  const tree = buildTriangleTree([
    1, -20, -20, 1, 20, -20, 1, -20, 20, 1, 20, -20, 1, 20, 20, 1, -20, 20,
  ]);
  const capsule = { feet: new Float64Array([0, 0, -2]), radius: 0.5, height: 2 };
  const velocity = new Float64Array([100, 0, 10]);
  const report = freshReport({ ground: false, wall: false, impact: 0 });
  slide(
    triangleCollision(tree),
    { capsule, velocity },
    { ...rules, stepTop: Infinity },
    [10, 0, 1],
    report,
  );
  assert.ok(Math.abs(capsule.feet[0] - 0.5) < 1e-10);
  assert.ok(Math.abs(capsule.feet[2] + 1) < 1e-10);
  assert.deepEqual([...velocity], [0, 0, 10]);
  assert.equal(report.wall, true);
});

test('an overlap no push resolves is asked MOVE_PASSES times a part and looked at once, then the move goes on', () => {
  const capsule = { feet: new Float64Array(3), radius: 1, height: 2 };
  let asked = 0;
  const stuck = { groundBelow: () => null, resolveCapsule: () => (asked++, true) };
  // 1.2 m in parts of half a radius: three parts.
  slide(
    stuck,
    { capsule, velocity: new Float64Array(3) },
    rules,
    [1.2, 0, 0],
    freshReport({ ground: false, wall: false, impact: 0 }),
  );
  // MOVE_PASSES passes, then one look at what they left: no overlap deeper than before.
  assert.equal(asked, 3 * (MOVE_PASSES + 1));
  near(capsule.feet, [1.2, 0, 0], 'feet', 1e-12);
});

/** A world whose only surface is an overlap `depth(feet)` deep, always there, its way out up:
 *  no pass can leave it, so every part ends with its passes spent. */
function overlap(depth: (feet: Float64Array) => number) {
  return {
    groundBelow: () => null,
    resolveCapsule: (capsule: { feet: Float64Array }, push: (touch: CapsuleContact) => void) => {
      push({
        normal: new Float64Array([0, -1, 0]),
        surface: new Float64Array([0, -1, 0]),
        point: Float64Array.from(capsule.feet),
        depth: depth(capsule.feet),
      });
      return true;
    },
  };
}

test('a part that carries a body no deeper into an overlap is taken; one carrying it deeper is not', () => {
  const report = () => freshReport({ ground: false, wall: false, impact: 0 });
  const move = (depth: (feet: Float64Array) => number) => {
    const capsule = { feet: new Float64Array(3), radius: 1, height: 2 };
    const velocity = new Float64Array([2, 0, 0]);
    const into = slide(overlap(depth), { capsule, velocity }, rules, [0.4, 0, 0], report());
    return { x: capsule.feet[0], vx: velocity[0], wall: into.wall };
  };
  // As deep all along, or shallower ahead: the part is taken.
  assert.ok(Math.abs(move(() => 0.1).x - 0.4) < 1e-12);
  assert.ok(Math.abs(move((feet) => 0.5 - feet[0] / 2).x - 0.4) < 1e-12);
  // Deeper ahead: the body stays, loses the speed that drove it in, and meets a wall.
  const deeper = move((feet) => 0.1 + feet[0]);
  assert.deepEqual(deeper, { x: 0, vx: 0, wall: true });
});

test('only a wall under the centre waits for the second pass; a level one is left at once', () => {
  // A world that answers each contact once, on its first pass: what the first pass does not
  // push is never pushed. A level wall is pushed; a steep slope under the centre waits.
  const once = (normal: number[]) => {
    let asked = 0;
    return {
      groundBelow: () => null,
      resolveCapsule: (capsule: { feet: Float64Array }, push: (touch: CapsuleContact) => void) => {
        if (asked++ > 0) return false;
        push({
          normal: new Float64Array(normal),
          surface: new Float64Array(normal),
          point: Float64Array.from(capsule.feet),
          depth: 0.1,
        });
        return true;
      },
    };
  };
  const leave = (normal: number[]) => {
    const capsule = { feet: new Float64Array(3), radius: 1, height: 2 };
    const report = freshReport({ ground: false, wall: false, impact: 0 });
    slide(
      once(normal),
      { capsule, velocity: new Float64Array(3) },
      { ...rules, onGround: true },
      [0, 0, 0],
      report,
    );
    return [...capsule.feet];
  };
  near(leave([-1, 0, 0]), [-0.1, 0, 0], 'level wall', 1e-12);
  near(leave([-0.8, 0.6, 0]), [0, 0, 0], 'steep slope under the centre', 1e-12);
});
