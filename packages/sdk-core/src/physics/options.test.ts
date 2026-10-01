import test from 'node:test';
import assert from 'node:assert/strict';
import { refuses } from '../contracts/cache.fixture.ts';
import {
  checkPhysicsBudget,
  collisionBytesOf,
  DEFAULT_PHYSICS_BUDGET,
  physicsBudgetOf,
  type PhysicsBudget,
} from './options.ts';
import { MODULE_MEMORY } from './wire.fixture.ts';

const declared = { bodies: 7, decorative: 3, softVertices: 11, memoryBytes: 1001 };

/** Asserts `run` refuses a budget by name: its code, and each detail in its message. */
const refused = (run: () => unknown, details: Record<string, unknown>) =>
  refuses(run, 'PHYSICS_BUDGET', details, Object.values(details).map(String));

test('a budget keeps what it declares over the defaults, sealed against a key that is no budget', () => {
  const budget = physicsBudgetOf(declared);
  assert.deepEqual(budget, { ...DEFAULT_PHYSICS_BUDGET, ...declared });
  assert.deepEqual(physicsBudgetOf(), DEFAULT_PHYSICS_BUDGET);
  assert.notEqual(physicsBudgetOf(), DEFAULT_PHYSICS_BUDGET, 'a budget of its own, writable');
  assert.ok(Object.isSealed(budget));
  assert.throws(() => {
    (budget as unknown as Record<string, number>).triangles = 100;
  }, TypeError);
  refused(() => physicsBudgetOf({ removed: 7 } as Partial<PhysicsBudget>), { budget: 'removed' });
});

test('the default budget opens the physics module', () => {
  assert.ok(DEFAULT_PHYSICS_BUDGET.memoryBytes >= MODULE_MEMORY);
});

test('the static collision holds a share of the memory, never more than all of it', () => {
  for (const memoryBytes of [1001, DEFAULT_PHYSICS_BUDGET.memoryBytes]) {
    const bytes = collisionBytesOf({ memoryBytes });
    assert.ok(Number.isInteger(bytes) && bytes > 0 && bytes < memoryBytes, `${bytes}`);
  }
  assert.equal(
    collisionBytesOf({ memoryBytes: 2000 }),
    2 * collisionBytesOf({ memoryBytes: 1000 }),
  );
});

test('a request at its limit fits, the first past it is refused naming the governing budget', () => {
  const budget = physicsBudgetOf(declared);
  const collision = collisionBytesOf(budget);
  for (const [key, limit] of [
    ['bodies', declared.bodies],
    ['decorative', declared.decorative],
    ['softVertices', declared.softVertices],
    ['collisionBytes', collision],
  ] as const) {
    const name = key === 'collisionBytes' ? 'memoryBytes' : key;
    assert.doesNotThrow(() => checkPhysicsBudget(budget, key, 0));
    assert.doesNotThrow(() => checkPhysicsBudget(budget, key, limit));
    refused(() => checkPhysicsBudget(budget, key, limit + 1), {
      budget: name,
      limit,
      requested: limit + 1,
    });
  }
});
