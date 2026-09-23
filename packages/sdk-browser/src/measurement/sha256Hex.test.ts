// A14: `toHex`/`sha256Hex` read a table of 256 hexadecimal strings already written instead of a
// `toString(16).padStart(2, '0')` per byte. Oracle: the `toString` version from before batch A,
// in `../../../../bench/oracles/browser/telemetrie.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from './sha256Hex.ts';
import { referenceHex } from '../../../../bench/oracles/browser/telemetrie.ts';

test('an empty digest is the empty string on both sides', () => {
  assert.equal(toHex(new Uint8Array(0)), '');
  assert.equal(referenceHex(new Uint8Array(0)), '');
});

test('every single byte value 0..255 hex-encodes identically, leading zero included', () => {
  for (let b = 0; b <= 255; b++) {
    const bytes = new Uint8Array([b]);
    assert.equal(toHex(bytes), referenceHex(bytes), `byte ${b}`);
  }
  assert.equal(toHex(new Uint8Array([0])), '00');
  assert.equal(toHex(new Uint8Array([255])), 'ff');
});

test('a 32-byte SHA-256-shaped digest matches the reference exactly', () => {
  const digest = new Uint8Array(32);
  for (let i = 0; i < 32; i++) digest[i] = (i * 37 + 11) % 256;
  assert.equal(toHex(digest), referenceHex(digest));
  assert.equal(toHex(digest).length, 64);
});
