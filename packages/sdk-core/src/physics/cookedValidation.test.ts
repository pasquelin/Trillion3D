import test from 'node:test';
import assert from 'node:assert/strict';
import { readCookedPhysics } from './cooked.ts';
import { EngineError } from '../contracts/cache.ts';

const valid = { formatVersion: 2, jolt: 'test-build', colliders: [], instances: [] };

test('cooked physics refuses each malformed list with a useful format error', () => {
  for (const key of ['colliders', 'instances', 'softBodies', 'bodies']) {
    for (const value of [null, {}, 'bad']) {
      assert.throws(
        () => readCookedPhysics({ ...valid, [key]: value }, 'test-build'),
        (error: unknown) => {
          assert.ok(error instanceof EngineError);
          assert.equal(error.code, 'PHYSICS_FORMAT');
          assert.ok(error.message.includes(key));
          return true;
        },
      );
    }
  }
  assert.equal(readCookedPhysics(valid, 'test-build'), valid);
});

test('format and compiler refusals retain the incompatible identifier for the caller', () => {
  for (const file of [null, undefined, {}, { formatVersion: 99 }]) {
    assert.throws(
      () => readCookedPhysics(file),
      (error: unknown) => {
        assert.ok(error instanceof EngineError);
        assert.equal(error.code, 'PHYSICS_FORMAT');
        assert.deepEqual(error.details, { formatVersion: file?.formatVersion ?? null });
        assert.ok(error.message.includes('recompile the model'));
        return true;
      },
    );
  }
  for (const jolt of [undefined, '', 'old-build']) {
    assert.throws(
      () => readCookedPhysics({ ...valid, jolt }, 'new-build'),
      (error: unknown) => {
        assert.ok(error instanceof EngineError);
        assert.deepEqual(error.details, { jolt: jolt ?? null });
        assert.ok(error.message.includes('new-build') && error.message.includes(String(jolt)));
        return true;
      },
    );
  }
});
