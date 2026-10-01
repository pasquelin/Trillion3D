import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refuses } from '../contracts/cache.fixture.ts';
import { readCookedPhysics } from './cooked.ts';
import { JOLT_COMMIT } from './joltCommit.ts';

/** The formats the compiler's cook writes (`physics_cook.rs`): plain, and with its pieces. */
const cook = readFileSync(
  new URL('../../../asset-compiler-rust/src/physics_cook.rs', import.meta.url),
  'utf8',
);
const read = ['PHYSICS_FORMAT_VERSION', 'PIECES_FORMAT_VERSION'].map((name) =>
  Number(cook.match(new RegExp(`const ${name}: u32 = (\\d+);`))![1]),
);
const file = { formatVersion: read[0], jolt: JOLT_COMMIT, colliders: [], instances: [] };
/** A version that is none of those read. */
const unread = Math.max(...read) + 1;

test('physics.json of each format read, cooked by this Jolt, is read as it is', () => {
  for (const formatVersion of read) {
    const later = { ...file, formatVersion, softBodies: [], bodies: [] };
    assert.equal(readCookedPhysics(later), later, `format ${formatVersion}, pieces carried`);
  }
  assert.equal(readCookedPhysics(file), file, 'no soft or declared bodies');
  assert.equal(readCookedPhysics({ ...file, jolt: 'a-build' }, 'a-build').jolt, 'a-build');
});

test('another format, or none, is refused naming the version found and, one by one, those read', () => {
  // Format 1, as the cook wrote it before #475: its dynamic `bodies`, no matter on an instance.
  for (const [wrong, found] of [
    [{ ...file, formatVersion: 1, bodies: [] }, 1],
    [{ ...file, formatVersion: unread }, unread],
    [{ formatVersion: String(read[0]) }, String(read[0])],
    [{}, null],
    [null, null],
    [undefined, null],
  ] as const) {
    const message = refuses(() => readCookedPhysics(wrong), 'PHYSICS_FORMAT', {
      formatVersion: found,
    });
    assert.ok(message.includes(String(found ?? undefined)), message);
    for (const version of read) assert.match(message, new RegExp(`\\b${version}\\b`));
  }
});

test('shapes cooked by another Jolt are refused naming both builds', () => {
  for (const jolt of [undefined, '', '0'.repeat(40)])
    refuses(() => readCookedPhysics({ ...file, jolt }), 'PHYSICS_FORMAT', { jolt: jolt ?? null }, [
      String(jolt),
      JOLT_COMMIT,
    ]);
});

test('a list missing or not a list is refused by name', () => {
  for (const key of ['colliders', 'instances', 'softBodies', 'bodies'])
    for (const value of [null, {}, 'bad'])
      refuses(() => readCookedPhysics({ ...file, [key]: value }), 'PHYSICS_FORMAT', undefined, [
        key,
      ]);
  for (const key of ['colliders', 'instances'] as const) {
    const { [key]: _, ...without } = file;
    refuses(() => readCookedPhysics(without), 'PHYSICS_FORMAT', undefined, [key]);
  }
});
