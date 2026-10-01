import assert from 'node:assert/strict';
import test from 'node:test';
import { unionViewReach } from './viewReach.ts';

test('separated camera reaches survive one partition query without dropping either camera’s cells', () => {
  const inputs = [
    { eye: [-100, 10, 30], reach: 20 },
    { eye: [150, -40, 7], reach: 80 },
    { eye: [10, 0, -200], reach: 5 },
  ];
  const union = unionViewReach(inputs);
  for (const view of inputs) {
    for (const axis of [0, 1, 2])
      for (const sign of [-1, 1]) {
        const point = view.eye.slice();
        point[axis] += sign * view.reach;
        assert.ok(Math.hypot(...point.map((x, i) => x - union.eye[i])) <= union.reach + 1e-10);
      }
  }
  assert.deepEqual(
    unionViewReach([inputs[0]]),
    inputs[0],
    'one camera keeps exactly its former reach',
  );
  assert.equal(unionViewReach([inputs[0], { eye: [1, 2, 3], reach: Infinity }]).reach, Infinity);
});
