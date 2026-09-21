import { TEMPLATES, sha, manifest } from '../../test/fixtures/manifestBinary.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertManifestBinary,
  decodeManifestBinary,
  encodeManifestBinary,
  MANIFEST_BINARY_MAGIC,
  MANIFEST_BINARY_VERSION,
} from './manifestBinary.ts';
import { assertCacheIdentity, EngineError, type ClusterManifest } from './contracts.ts';
import { MAX_DEPTH_LAYER } from './depthLayer.ts';

/** The bytes a `Uint8Array` view owns, as a plain `ArrayBuffer`: `encodeManifestBinary` always
 *  backs its view with one, but `.buffer` types as the wider `ArrayBufferLike`. */
function ownBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

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
  const decoded = decodeManifestBinary(JSON.parse(text), ownBuffer(binary));
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
  const buffer = ownBuffer(binary);
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

// Behaviour 10: TypeScript encoding rejects a depthLayer that exceeds four bits (> 15)
// and accepts the limit value.
test('encodeManifestBinary rejects a depth layer above 15 and accepts the four-bit limit', () => {
  const tooDeep = manifest();
  tooDeep.primitives[0].pages[0].depthLayer = MAX_DEPTH_LAYER + 1;
  assert.throws(
    () => encodeManifestBinary(tooDeep, TEMPLATES),
    (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE',
  );
  const atLimit = manifest();
  atLimit.primitives[0].pages[0].depthLayer = MAX_DEPTH_LAYER;
  assert.doesNotThrow(() => encodeManifestBinary(atLimit, TEMPLATES));
});

// Behaviour 11: pageDepthLayer round-trips through the binary columns; layer 0
// leaves the field absent, so a page keeps a single shape after decode.
test('depthLayer round-trips through the binary columns, and layer 0 leaves the field absent', () => {
  const source = manifest();
  source.primitives[0].pages[0].depthLayer = 7;
  const { manifest: slim, binary } = encodeManifestBinary(source, TEMPLATES);
  slim.binary.sha256 = sha('f');
  const decoded = decodeManifestBinary(JSON.parse(JSON.stringify(slim)), ownBuffer(binary));
  assert.equal(decoded.primitives[0].pages[0].depthLayer, 7);
  assert.equal(
    'depthLayer' in decoded.primitives[0].pages[1],
    false,
    'the second page (layer 0) carries no depthLayer field after decode',
  );
  assert.equal(
    'depthLayer' in decoded.primitives[1].pages[0],
    false,
    'no layer declared in the source: still absent after decode',
  );
});

// Behaviour 13: assertManifestBinary rejects any sidecar whose version is not its own.
test('assertManifestBinary accepts this version and refuses every other one', () => {
  const descriptor = {
    version: MANIFEST_BINARY_VERSION,
    url: 'clusters.bin',
    sha256: 'a'.repeat(64),
    bytes: 8,
    pageUrl: '../../objects/{sha}.bin',
    geometryUrl: '../../objects/{sha}.bin',
    bundleUrl: '../../objects/{sha}.bin',
    texturePreviews: 0,
    texturePreviewBytes: 0,
  };
  assert.doesNotThrow(() => assertManifestBinary(descriptor));
  for (const version of [0, 1, 2, 3, 999])
    assert.throws(
      () => assertManifestBinary({ ...descriptor, version }),
      (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
    );
});

// Behaviour 10: assertManifestBinary rejects a descriptor with no texture preview count, and
// split/decodeManifestBinary round-trips the preview section without losing a byte.
test('assertManifestBinary rejects a descriptor with no texture preview count', () => {
  const descriptor = {
    version: MANIFEST_BINARY_VERSION,
    url: 'clusters.bin',
    sha256: 'a'.repeat(64),
    bytes: 8,
    pageUrl: '../../objects/{sha}.bin',
    geometryUrl: '../../objects/{sha}.bin',
    bundleUrl: '../../objects/{sha}.bin',
  };
  assert.throws(
    () => assertManifestBinary(descriptor),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
  );
  assert.throws(
    () => assertManifestBinary({ ...descriptor, texturePreviews: -1 }),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
  );
});
test('encodeManifestBinary and decodeManifestBinary round-trip the texture preview section', () => {
  const source = manifest();
  const { manifest: slim, binary } = encodeManifestBinary(source, TEMPLATES);
  slim.binary.sha256 = sha('f');
  assert.equal(slim.binary.texturePreviews, 1);
  const decoded = decodeManifestBinary(JSON.parse(JSON.stringify(slim)), ownBuffer(binary));
  assert.deepEqual(decoded.texturePreviews, source.texturePreviews);
});
