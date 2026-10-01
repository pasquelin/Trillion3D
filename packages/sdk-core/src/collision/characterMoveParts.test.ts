import test from 'node:test';
import assert from 'node:assert/strict';
import { freshReport, slide } from './characterMove.ts';
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
