import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, sha, manifest } from '../../../../tests/fixtures/manifestBinary.ts';
import { decodeManifestBinary, encodeManifestBinary } from './binary.ts';
import { EngineError } from '../contracts/index.ts';

// A version-9 page always has a cone: a hand-written page without one gets the open cone.
test('a page without a cone decodes the open cone, and a malformed cone is refused', () => {
  const bare = manifest();
  delete bare.primitives[0].pages[0].cone;
  const { manifest: slim, binary } = encodeManifestBinary(bare, TEMPLATES);
  slim.binary.sha256 = sha('f');
  const decoded = decodeManifestBinary(slim, binary.slice().buffer);
  assert.deepEqual(decoded.primitives[0].pages[0].cone, { axis: [0, 0, 1], angle: Math.PI });
  const malformed = [
    { axis: [0, 1], angle: 0 },
    { axis: new Array(3), angle: 0 },
    { axis: [0, 0, 1], angle: NaN },
    { angle: 1 },
    null,
  ];
  for (const cone of malformed) {
    const bad = manifest();
    bad.primitives[0].pages[0].cone = cone as never;
    assert.throws(
      () => encodeManifestBinary(bad, TEMPLATES),
      (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE',
    );
  }
});
