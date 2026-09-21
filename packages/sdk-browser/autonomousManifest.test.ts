// The autonomous manifest points every page at its cluster page and keeps the descriptors by
// URL; the page format is read once, at the top of the manifest, and refused whole otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAutonomousManifest } from './autonomousManifest.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

const geometry = (url: string) => ({
  url,
  sha256: 'x',
  bytes: 96,
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
const geometryPages = { formatVersion: 3, codec: 'quantized' };

test('the pages point at their cluster pages and the format is checked once, at the top', () => {
  const { descriptors, metadata } = prepareAutonomousManifest({
    geometryPages,
    primitives: [{ pages: [page('a.bin')] }, { pages: [page('b.bin')] }],
  } as unknown as ClusterManifest);
  assert.deepEqual(descriptors.get('b.bin'), geometry('b.bin'));
  assert.equal(metadata.primitives[0].pages[0].url, 'a.bin');
  for (const manifest of [
    { geometryPages: { ...geometryPages, formatVersion: 2 }, primitives: [{ pages: [page('c')] }] },
    { geometryPages, primitives: [{ pages: [{ ...page('c'), geometry: undefined }] }] },
  ])
    assert.throws(
      () => prepareAutonomousManifest(manifest as unknown as ClusterManifest),
      /AUTONOMOUS_PAGE_MISSING/,
    );
});
