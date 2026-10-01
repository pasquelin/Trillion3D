import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../contracts/cache.ts';
import { readCookedPhysics } from './cooked.ts';
import { JOLT_COMMIT } from './joltCommit.ts';

const file = { formatVersion: 2, jolt: JOLT_COMMIT, colliders: [], instances: [] };

/** Asserts `read` refuses the file as `PHYSICS_FORMAT`, its message naming each of `named`, a
 *  number as a word of its own. */
function refused(read: () => unknown, named: unknown[], details?: Record<string, unknown>) {
  assert.throws(read, (error: unknown) => {
    assert.ok(error instanceof EngineError);
    assert.equal(error.code, 'PHYSICS_FORMAT');
    if (details) assert.deepEqual(error.details, details);
    for (const name of named)
      assert.ok(
        typeof name === 'number'
          ? new RegExp(`\\b${name}\\b`).test(error.message)
          : error.message.includes(String(name)),
        error.message,
      );
    return true;
  });
}

test('physics.json of a format read, cooked by this Jolt, is read as it is', () => {
  assert.equal(readCookedPhysics(file), file);
  const later = { ...file, formatVersion: 3, softBodies: [], bodies: [] };
  assert.equal(readCookedPhysics(later), later, 'pieces carried');
  assert.equal(readCookedPhysics({ ...file, jolt: 'a-build' }, 'a-build').jolt, 'a-build');
});

test('another format, or none, is refused naming the version found and the ones read', () => {
  // Format 1, as the cook wrote it before #475: its dynamic `bodies`, no matter on an instance.
  for (const [wrong, found] of [
    [{ ...file, formatVersion: 1, bodies: [] }, 1],
    [{ ...file, formatVersion: 4 }, 4],
    [{ formatVersion: '2' }, '2'],
    [{}, null],
    [null, null],
    [undefined, null],
  ] as const)
    refused(() => readCookedPhysics(wrong), [found ?? 'undefined', 2, 3], { formatVersion: found });
});

test('shapes cooked by another Jolt are refused naming both builds', () => {
  for (const jolt of [undefined, '', '0'.repeat(40)])
    refused(() => readCookedPhysics({ ...file, jolt }), [String(jolt), JOLT_COMMIT], {
      jolt: jolt ?? null,
    });
});

test('a list missing or not a list is refused by name', () => {
  for (const key of ['colliders', 'instances', 'softBodies', 'bodies'])
    for (const value of [null, {}, 'bad'])
      refused(() => readCookedPhysics({ ...file, [key]: value }), [key]);
  for (const key of ['colliders', 'instances'] as const) {
    const { [key]: _, ...without } = file;
    refused(() => readCookedPhysics(without), [key]);
  }
});
