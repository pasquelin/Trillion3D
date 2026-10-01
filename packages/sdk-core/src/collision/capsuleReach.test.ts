import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriangleTree } from './triangleTree.ts';
import { capsulePass } from './capsule.ts';

test('degenerate triangle points preserve an actual separating surface direction', () => {
  const tree = buildTriangleTree([3, 4, 5, 3, 4, 5, 3, 4, 5]);
  const capsule = { feet: new Float64Array([3.3, 3.5, 5]), radius: 0.5, height: 1 };
  let seen = 0;
  assert.equal(
    capsulePass(tree, capsule, (touch) => {
      seen++;
      assert.ok(Math.abs(touch.depth - 0.2) < 1e-12);
      assert.deepEqual([...touch.normal], [1, 0, 0]);
      assert.deepEqual([...touch.surface], [1, 0, 0]);
    }),
    true,
  );
  assert.equal(seen, 1);
});

test('large-radius capsules detect surfaces on both sides beyond one metre', () => {
  for (const side of [-1, 1]) {
    const x = 3 + side * 1.5;
    const tree = buildTriangleTree([x, -8, -3, x, 8, -3, x, -8, 13]);
    const capsule = { feet: new Float64Array([3, -2, 5]), radius: 2, height: 4 };
    let count = 0;
    assert.equal(
      capsulePass(tree, capsule, (touch) => {
        count++;
        assert.ok(Math.abs(touch.depth - 0.5) < 1e-12);
        assert.ok(Math.abs(touch.normal[0] + side) < 1e-12);
      }),
      true,
    );
    assert.equal(count, 1);
  }
});

test('zero-thickness and degenerate coincident contacts never report a positive-volume overlap', () => {
  const floor = buildTriangleTree([-4, 0, -4, -4, 0, 4, 4, 0, -4]);
  assert.equal(
    capsulePass(floor, { feet: new Float64Array([-0.1, -1, -0.2]), radius: 0, height: 2 }, () =>
      assert.fail('a zero-radius line has no penetration volume'),
    ),
    false,
  );
  const point = buildTriangleTree([3, 4, 5, 3, 4, 5, 3, 4, 5]);
  capsulePass(point, { feet: new Float64Array([3, 3.5, 5]), radius: 0.5, height: 1 }, (touch) =>
    assert.ok(touch.depth > 0, 'reported contacts must have strictly positive depth'),
  );
});

test('the upper capsule cap detects a ceiling well above its lower sphere', () => {
  const ceiling = buildTriangleTree([-4, 3.75, -4, -4, 3.75, 4, 4, 3.75, -4]);
  const capsule = { feet: new Float64Array([0, 0, -1]), radius: 0.5, height: 4 };
  let count = 0;
  assert.equal(
    capsulePass(ceiling, capsule, (touch) => {
      count++;
      assert.equal(touch.depth, 0.25);
      assert.deepEqual([...touch.normal], [0, -1, 0]);
    }),
    true,
  );
  assert.equal(count, 1);
});
