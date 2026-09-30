import test from 'node:test';
import assert from 'node:assert/strict';
import { physicsBudgetOf, checkPhysicsBudget, collisionBytesOf } from './options.ts';

test('physics budgets preserve declared limits, seal unknown fields and refuse unsupported names', () => {
  const budget = physicsBudgetOf({ bodies: 7, decorative: 3, softVertices: 11, memoryBytes: 1001 });
  assert.deepEqual(
    [budget.bodies, budget.decorative, budget.softVertices, budget.memoryBytes],
    [7, 3, 11, 1001],
  );
  assert.equal(Object.isSealed(budget), true);
  assert.throws(() => {
    (budget as any).triangles = 100;
  }, TypeError);
  assert.throws(
    () => physicsBudgetOf({ removed: 7 } as any),
    (error: any) =>
      error.code === 'PHYSICS_BUDGET' &&
      error.message.includes('removed') &&
      error.details.budget === 'removed',
  );
  const defaults = physicsBudgetOf();
  assert.ok(defaults.bodies > 0 && defaults.decorative > 0 && defaults.softVertices > 0);
  assert.ok(
    collisionBytesOf(defaults) > 1024 * 1024,
    'the default retains usable collision memory',
  );
});

test('requests at each limit fit while the first excess names the actual governing budget', () => {
  const budget = physicsBudgetOf({ bodies: 7, decorative: 3, softVertices: 11, memoryBytes: 1001 });
  assert.equal(collisionBytesOf(budget), 500);
  for (const [key, limit, name] of [
    ['bodies', 7, 'bodies'],
    ['decorative', 3, 'decorative'],
    ['softVertices', 11, 'softVertices'],
    ['collisionBytes', 500, 'memoryBytes'],
  ] as const) {
    assert.doesNotThrow(() => checkPhysicsBudget(budget, key, limit));
    assert.doesNotThrow(() => checkPhysicsBudget(budget, key, 0));
    assert.throws(
      () => checkPhysicsBudget(budget, key, limit + 1),
      (error: any) => {
        assert.equal(error.code, 'PHYSICS_BUDGET');
        assert.deepEqual(error.details, { budget: name, limit, requested: limit + 1 });
        assert.ok(error.message.includes(name) && error.message.includes(String(limit + 1)));
        return true;
      },
    );
  }
});
