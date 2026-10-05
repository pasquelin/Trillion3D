// A14: `sha256Hex` reads a table of 256 hexadecimal strings already written instead of a
// `toString(16).padStart(2, '0')` per byte. Oracle: the `toString` version from before batch A,
// in `../../../../bench/oracles/browser/telemetry.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from './sha256Hex.ts';
import { referenceHex } from '../../../../bench/oracles/browser/telemetry.ts';

const digestOf = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

test('an empty buffer hashes to the known SHA-256, as the reference writes it', async () => {
  const hex = await sha256Hex(new ArrayBuffer(0));
  assert.equal(hex, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex, referenceHex(await digestOf(new Uint8Array(0))));
});

test('every single byte value 0..255 hashes to the string the reference writes, leading zeros included', async () => {
  for (let b = 0; b <= 255; b++) {
    const bytes = new Uint8Array([b]);
    assert.equal(await sha256Hex(bytes.buffer), referenceHex(await digestOf(bytes)), `byte ${b}`);
  }
});

test('a longer buffer is 64 lowercase hexadecimal characters, the reference exactly', async () => {
  const bytes = new Uint8Array(1000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
  const hex = await sha256Hex(bytes.buffer);
  assert.equal(hex, referenceHex(await digestOf(bytes)));
  assert.match(hex, /^[0-9a-f]{64}$/);
});
