// Batch F, F19: `writeSha` (binaryLayout.ts) used to validate the digest with a regular
// expression then walk it a second time to write it. It now reads each code once, into a shared
// scratch, and stores the digest only after all 64 characters are accepted.
// The oracle is the implementation from before batch F, copied as-is into `oracles/manifeste-binaire.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeSha } from './binaryLayout.ts';
import { referenceWriteSha } from '../../../../bench/oracles/core/binary-manifest.ts';

const VALID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function bothThrow(sha: string) {
  let threwNeuf = false,
    threwRef = false;
  try {
    writeSha(new Uint8Array(64), 0, sha);
  } catch {
    threwNeuf = true;
  }
  try {
    referenceWriteSha(new Uint8Array(64), 0, sha);
  } catch {
    threwRef = true;
  }
  return { threwNeuf, threwRef };
}

test('a valid 64-char lowercase hex digest writes the same bytes as the reference', () => {
  for (const sha of [
    VALID,
    '0'.repeat(64),
    'f'.repeat(64),
    '0123456789abcdef'.repeat(4),
    '9'.repeat(64),
  ]) {
    const target = new Uint8Array(128),
      reference = new Uint8Array(128);
    writeSha(target, 1, sha);
    referenceWriteSha(reference, 1, sha);
    for (let i = 0; i < target.length; i++)
      assert.ok(Object.is(target[i], reference[i]), `byte ${i} for ${sha}`);
  }
});

test('a hostile digest (length, case, non-hex character) is rejected on both sides, without writing', () => {
  const hostiles = [
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64), // uppercase: outside [0-9a-f]
    `${'a'.repeat(63)}g`, // a non-hex character at the last position
    `z${'a'.repeat(63)}`, // ... at the first position
    `${'a'.repeat(32)} ${'a'.repeat(31)}`, // a space in the middle
    '/'.repeat(64), // just before '0' (0x2f)
    ':'.repeat(64), // just after '9' (0x3a)
    '`'.repeat(64), // just before 'a' (0x60)
    'g'.repeat(64), // just after 'f' (0x67)
  ];
  for (const sha of hostiles) {
    const { threwNeuf, threwRef } = bothThrow(sha);
    assert.equal(threwNeuf, true, `writeSha should have rejected ${JSON.stringify(sha)}`);
    assert.equal(threwRef, true, `the reference should have rejected ${JSON.stringify(sha)}`);
    // No write must survive a rejection: the target stays zero.
    const target = new Uint8Array(64);
    try {
      writeSha(target, 0, sha);
    } catch {
      // attendu
    }
    assert.ok(
      target.every((byte) => byte === 0),
      `writeSha wrote despite rejection for ${JSON.stringify(sha)}`,
    );
  }
});

test('the 16 hexadecimal digits cover every position without altering neighbouring bytes', () => {
  const target = new Uint8Array(192).fill(0xff);
  const reference = new Uint8Array(192).fill(0xff);
  writeSha(target, 1, VALID);
  referenceWriteSha(reference, 1, VALID);
  for (let i = 0; i < target.length; i++)
    assert.ok(Object.is(target[i], reference[i]), `byte ${i}: slot 1 border`);
});

test('two valid digests written in a row do not mix in the shared scratch', () => {
  const shaA = '0'.repeat(64),
    shaB = 'f'.repeat(64);
  const target = new Uint8Array(128),
    reference = new Uint8Array(128);
  writeSha(target, 0, shaA);
  writeSha(target, 1, shaB);
  referenceWriteSha(reference, 0, shaA);
  referenceWriteSha(reference, 1, shaB);
  for (let i = 0; i < target.length; i++)
    assert.ok(Object.is(target[i], reference[i]), `byte ${i}`);
  // A rejected write between the two must leave no trace in the next slot.
  assert.throws(() => writeSha(target, 2, 'z'.repeat(64)));
  assert.ok(
    target.subarray(128).every((byte) => byte === 0),
    'slot 2, never written, stays zero',
  );
});
