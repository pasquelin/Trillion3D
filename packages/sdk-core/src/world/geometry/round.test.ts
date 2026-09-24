import test from 'node:test';
import assert from 'node:assert/strict';
import { SplineCurve } from '../math/curves.ts';
import { Vector3 } from '../math/vector3.ts';
import { torusKnot, tube } from './round.ts';

/** Every vertex of the last ring of a `(tubular + 1) × (radial + 1)` sweep sits on the first's. */
function assertCloses(position: ArrayLike<number>, tubular: number, radial: number) {
  for (let j = 0; j <= radial; j++) {
    const [first, last] = [j * (tubular + 1) * 3, (j * (tubular + 1) + tubular) * 3];
    for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(position[first + k] - position[last + k]) < 1e-9, `ring vertex ${j}`);
  }
}

test('a torus knot closes: its last ring lands on its first, vertex for vertex', () => {
  const [tubular, radial] = [480, 40];
  assertCloses(
    torusKnot(1.5, 0.34, tubular, radial, 2, 3).attributes.position.array,
    tubular,
    radial,
  );
});

test('a closed tube along a curve out of any plane closes on itself', () => {
  const points = [
    [1, 0, 0],
    [0, 1, 0.6],
    [-1, 0, 0],
    [0, -1, -0.8],
    [0.4, 0.3, 1],
  ].map(([x, y, z]) => new Vector3(x, y, z));
  assertCloses(
    tube(new SplineCurve(points, true), 64, 0.1, 8, true).attributes.position.array,
    64,
    8,
  );
});
