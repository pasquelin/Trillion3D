import test from 'node:test';
import assert from 'node:assert/strict';
import { torusKnot } from './round.ts';

test('a torus knot closes: its last ring lands on its first, vertex for vertex', () => {
  const [tubular, radial] = [480, 40];
  const position = torusKnot(1.5, 0.34, tubular, radial, 2, 3).attributes.position.array;
  for (let j = 0; j <= radial; j++) {
    const [first, last] = [j * (tubular + 1) * 3, (j * (tubular + 1) + tubular) * 3];
    for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(position[first + k] - position[last + k]) < 1e-9, `ring vertex ${j}`);
  }
});
