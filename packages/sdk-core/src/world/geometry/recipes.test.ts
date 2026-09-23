import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES } from './recipes.ts';
import type { Geometry } from './geometry.ts';

test('a count below what a shape closes with builds the fewest pieces, and the recipe says so', () => {
  const zeros: Record<string, unknown[]> = {
    box: [1, 1, 1, 0, 0, 0],
    plane: [1, 1, 0, 0],
    sphere: [1, 0, 0],
    circle: [1, 0],
    ring: [0.5, 1, 0, 0],
    cylinder: [1, 1, 1, 0, 0],
    cone: [1, 1, 0, 0],
    torus: [1, 0.4, 0, 0],
    torusKnot: [1, 0.4, 0, 0],
    capsule: [1, 1, 0, 0],
  };
  for (const [type, args] of Object.entries(zeros)) {
    const build = RECIPES[type] as (...a: unknown[]) => Geometry;
    const shape = build(...args);
    const counts = shape.recipe!.args.filter((arg, i) => args[i] === 0);
    assert.ok(
      counts.every((count) => Number(count) >= 1),
      `${type}: ${shape.recipe!.args}`,
    );
    const positions = Array.from(shape.attributes.position.array);
    assert.ok(positions.length > 0 && positions.every(Number.isFinite), `${type} is whole`);
    const rebuilt = build(...shape.recipe!.args).attributes.position.array;
    assert.deepEqual(Array.from(rebuilt), positions, `${type}: the recipe builds the same shape`);
  }
});
