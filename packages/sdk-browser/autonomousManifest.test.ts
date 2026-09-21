// A decoded page may leave its source box by the primitive's declared quantization error: the
// autonomous manifest hands that slack to the reader, and a page without a declared grid gets none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAutonomousManifest } from './autonomousManifest.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

const geometry = (url: string) => ({
  url,
  sha256: 'x',
  bytes: 96,
  formatVersion: 3 as const,
  codec: 'quantized' as const,
  vertexCount: 3,
  indexCount: 3,
  flags: 0,
  uncompressedBytes: 48,
});
const page = (url: string) => ({
  id: 0,
  url: 'index.bin',
  sha256: 'x',
  bytes: 12,
  count: 3,
  min: [0, 0, 0],
  max: [1, 1, 1],
  geometry: geometry(url),
});

test('the descriptor carries the primitive quantization error as bounds slack, zero without a grid', () => {
  const { descriptors, metadata } = prepareAutonomousManifest({
    primitives: [
      { pages: [page('a.bin')], quantization: { maxPositionError: 0.03 } },
      { pages: [page('b.bin')], quantization: null },
    ],
  } as unknown as ClusterManifest);
  assert.equal(descriptors.get('a.bin')?.positionError, 0.03);
  assert.equal(descriptors.get('b.bin')?.positionError, 0);
  assert.equal(metadata.primitives[0].pages[0].url, 'a.bin');
  assert.throws(
    () =>
      prepareAutonomousManifest({
        primitives: [
          { pages: [{ ...page('c.bin'), geometry: { ...geometry('c.bin'), formatVersion: 2 } }] },
        ],
      } as unknown as ClusterManifest),
    /AUTONOMOUS_PAGE_MISSING/,
  );
});
