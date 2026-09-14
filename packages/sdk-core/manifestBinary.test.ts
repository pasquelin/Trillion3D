import { TEMPLATES, sha, manifest } from '../../test/fixtures/manifestBinary.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeManifestBinary,
  encodeManifestBinary,
  MANIFEST_BINARY_MAGIC,
  MANIFEST_BINARY_VERSION,
} from './manifestBinary.ts';
import { assertCacheIdentity, EngineError } from './contracts.ts';

test('a manifest survives the binary columns unchanged, field by field', () => {
  const source = manifest();
  const { manifest: slim, binary } = encodeManifestBinary(source, TEMPLATES);
  slim.binary.sha256 = sha('f');
  const header = new Uint32Array(binary.buffer, binary.byteOffset, 4);
  assert.equal(header[0], MANIFEST_BINARY_MAGIC, 'the file names its own format');
  assert.equal(header[1], MANIFEST_BINARY_VERSION);
  assert.equal(slim.binary.bytes, binary.byteLength);
  // The small JSON keeps what a reader parses and loses what it maps.
  const text = JSON.stringify(slim);
  assert.ok(!text.includes(sha('a')), 'no cluster digest survives in the JSON');
  assert.ok(!text.includes('lodError'), 'no per-cluster number survives in the JSON');
  assert.equal(slim.primitives[0].binary.pages, 2);
  assert.deepEqual(slim.primitives[0].binary.structure, { version: 1, groups: 1, roots: 1 });
  assert.deepEqual(slim.primitives[1].binary, {
    pages: 1,
    culling: null,
    structure: null,
    streams: null,
  });
  const decoded = decodeManifestBinary(
    JSON.parse(text),
    binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength),
  );
  assert.deepEqual(decoded, source);
  // Identity is a property of the decoded pages, so it holds after decoding and not before.
  assertCacheIdentity(decoded);
  assert.throws(
    () => assertCacheIdentity(slim as unknown as ClusterManifest),
    (error: EngineError) => error.code === 'INVALID_CACHE',
  );
});

test('a binary from another version, or shorter than it claims, is refused', () => {
  const { manifest: slim, binary } = encodeManifestBinary(manifest(), TEMPLATES);
  slim.binary.sha256 = sha('f');
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  const bumped = buffer.slice(0);
  new Uint32Array(bumped, 4, 1)[0] = MANIFEST_BINARY_VERSION + 1;
  assert.throws(
    () => decodeManifestBinary(slim, bumped),
    (error: EngineError) => error.code === 'UNSUPPORTED_FORMAT',
  );
  const unsigned = buffer.slice(0);
  new Uint32Array(unsigned, 0, 1)[0] = 0;
  assert.throws(
    () => decodeManifestBinary(slim, unsigned),
    (error: EngineError) => error.code === 'INVALID_CACHE',
  );
  assert.throws(
    () => decodeManifestBinary(slim, buffer.slice(0, buffer.byteLength - 8)),
    (error: EngineError) => error.code === 'INVALID_CACHE',
  );
  const wrongCounts = structuredClone(slim);
  wrongCounts.primitives[0].binary.pages = 3;
  assert.throws(
    () => decodeManifestBinary(wrongCounts, buffer),
    (error: EngineError) => error.code === 'INVALID_CACHE',
  );
  const wrongVersion = structuredClone(slim);
  wrongVersion.binary.version = MANIFEST_BINARY_VERSION + 1;
  assert.throws(
    () => decodeManifestBinary(wrongVersion, buffer),
    (error: EngineError) => error.code === 'UNSUPPORTED_FORMAT',
  );
});

test('a cluster url that does not follow the manifest template is refused at encoding', () => {
  const source = manifest();
  source.primitives[0].pages[0].url = 'pages/0.bin';
  assert.throws(
    () => encodeManifestBinary(source, TEMPLATES),
    (error: EngineError) => error.code === 'INVALID_CACHE',
  );
});
