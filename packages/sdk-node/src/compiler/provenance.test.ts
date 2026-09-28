import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from './provenance.mts';

test('provenance hashes UTF-8 text and raw bytes with the same SHA-256 contract', () => {
  const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(sha256('abc'), abc);
  assert.equal(sha256(Buffer.from([97, 98, 99])), abc);
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('é'), sha256(Buffer.from([0xc3, 0xa9])));
});
