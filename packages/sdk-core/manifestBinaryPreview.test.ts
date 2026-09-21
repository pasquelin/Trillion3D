import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, sha } from '../../test/fixtures/manifestBinary.ts';
import { preview } from '../../test/fixtures/manifestBinaryPreview.ts';
import {
  encodeManifestBinary,
  decodeManifestBinary,
  type SlimClusterManifest,
} from './manifestBinary.ts';
import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  EngineError,
  type ClusterManifest,
  type TexturePreview,
} from './contracts.ts';
import { previewBlockBytes } from './texturePreviewLevels.ts';
import {
  COLUMN_NAMES,
  MANIFEST_BINARY_HEADER_WORDS,
  PREVIEW_WORDS,
} from './manifestBinaryFormat.ts';

function manifestWith(previews: TexturePreview[]): ClusterManifest {
  return {
    schema: CLUSTERED_BLEND_FORMAT_VERSION,
    status: 'ready',
    key: 'k',
    scope: 'full',
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: [],
    totalNodes: 0,
    primitives: [],
    texturePreviews: previews,
  } as ClusterManifest;
}
function encode(previews: TexturePreview[]) {
  const { manifest: slim, binary } = encodeManifestBinary(manifestWith(previews), TEMPLATES);
  slim.binary.sha256 = sha('f');
  // `encodeManifestBinary` always backs the view with a plain `ArrayBuffer`; `.buffer` types as
  // the wider `ArrayBufferLike`.
  const buffer = binary.buffer.slice(
    binary.byteOffset,
    binary.byteOffset + binary.byteLength,
  ) as ArrayBuffer;
  return { slim, buffer };
}
/** The `texturePreviewU32` words of entry `entry`, on the finished buffer: the only way to
 *  build a sidecar whose geometry or byte range lies without going through the encoder, which
 *  would reject it itself. */
function previewWord(buffer: ArrayBuffer, entry: number, field: number) {
  const header = new Uint32Array(buffer, 0, MANIFEST_BINARY_HEADER_WORDS + COLUMN_NAMES.length * 2);
  const index = COLUMN_NAMES.indexOf('texturePreviewU32');
  const offset = header[MANIFEST_BINARY_HEADER_WORDS + index * 2];
  return new Uint32Array(buffer, offset + (entry * PREVIEW_WORDS + field) * 4, 1);
}
// Word ranks, hardcoded here rather than imported: the test freezes the sidecar layout.
const PREVIEW_FIRST_LEVEL = 6,
  PREVIEW_PIXEL_OFFSET = 8,
  PREVIEW_PIXEL_BYTES = 9,
  PREVIEW_ATLAS = 10,
  PREVIEW_BAKED_LEVELS = 11,
  PREVIEW_LAYOUTS = 12;
function refused(buffer: ArrayBuffer, slim: SlimClusterManifest) {
  assert.throws(
    () => decodeManifestBinary(slim, buffer),
    (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE',
  );
}

// Behaviour 5: a version-4 sidecar round-trips, and its reader rejects a version 3.
test('a version 3 sidecar (the fixed-length preview entries) is refused, never read as version 4', () => {
  const { slim, buffer } = encode([preview(0, 32, 16, 1)]);
  const header = new Uint32Array(buffer, 0, 2);
  header[1] = 3;
  assert.throws(
    () => decodeManifestBinary(slim, buffer),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
  );
});

// Behaviour 5: declared geometry is recomputed from the dimensions, never trusted — a
// first level or pixel length that disagrees with them is rejected.
test('a declared first level that disagrees with the source dimensions is refused', () => {
  const { slim, buffer } = encode([preview(0, 128, 128, 1)]);
  previewWord(buffer, 0, PREVIEW_FIRST_LEVEL)[0] += 1;
  refused(buffer, slim);
});
test('a declared pixel byte count that disagrees with the source dimensions is refused', () => {
  const { slim, buffer } = encode([preview(0, 128, 128, 1)]);
  previewWord(buffer, 0, PREVIEW_PIXEL_BYTES)[0] += 4;
  refused(buffer, slim);
});

// Behaviour 5: an entry's byte range must follow the previous one with no gap or
// overlap — an offset that lies in either direction is rejected.
test('a pixel range offset that opens a gap after the previous entry is refused', () => {
  const { slim, buffer } = encode([preview(0, 4, 4, 1), preview(1, 4, 4, 2)]);
  previewWord(buffer, 1, PREVIEW_PIXEL_OFFSET)[0] += 8;
  refused(buffer, slim);
});
test('a pixel range offset that overlaps the previous entry is refused', () => {
  const { slim, buffer } = encode([preview(0, 4, 4, 1), preview(1, 4, 4, 2)]);
  previewWord(buffer, 1, PREVIEW_PIXEL_OFFSET)[0] -= 8;
  refused(buffer, slim);
});

test('atlas and baked levels round-trip, and the same texture may serve both atlases in order', () => {
  const color = { ...preview(3, 256, 128, 1), atlas: 0, bakedLevels: 2 };
  const data = { ...preview(3, 256, 128, 2), atlas: 1, bakedLevels: 2 };
  const { slim, buffer } = encode([preview(1, 8, 8, 0), color, data]);
  const decoded = decodeManifestBinary(slim, buffer).texturePreviews!;
  assert.equal(decoded.length, 3);
  assert.deepEqual(
    decoded.map((p) => [p.texture, p.atlas, p.bakedLevels]),
    [
      [1, 0, 0],
      [3, 0, 2],
      [3, 1, 2],
    ],
  );
  assert.equal(previewWord(buffer, 1, PREVIEW_ATLAS)[0], 0);
  assert.equal(previewWord(buffer, 2, PREVIEW_ATLAS)[0], 1);
  assert.equal(previewWord(buffer, 2, PREVIEW_BAKED_LEVELS)[0], 2);
});

test('the same texture twice for one atlas, or data before colour, is refused as unordered', () => {
  const twice = [preview(3, 8, 8, 1), preview(3, 8, 8, 2)];
  assert.throws(() => encode(twice), /not ordered by texture and atlas/);
  const backwards = [{ ...preview(3, 8, 8, 1), atlas: 1 }, preview(3, 8, 8, 2)];
  assert.throws(() => encode(backwards), /not ordered by texture and atlas/);
});

test('an unknown atlas, or more baked levels than lie above the tail, is refused by both sides', () => {
  assert.throws(() => encode([{ ...preview(0, 8, 8, 1), atlas: 2 }]), /unknown atlas/);
  assert.throws(
    () => encode([{ ...preview(0, 256, 256, 1), bakedLevels: 3 }]),
    /more levels than lie above its tail/,
  );
  // A sidecar whose word was forced after the fact is rejected on read, not only on write.
  const { slim, buffer } = encode([preview(0, 256, 256, 1)]);
  previewWord(buffer, 0, PREVIEW_ATLAS)[0] = 7;
  refused(buffer, slim);
});

// Behaviour: the block tails travel in their own columns with no written range — each kept
// entry's follows the previous at the length its dimensions imply, a lossless entry has none,
// its layout word says so — and a column that is short or long against those lengths is refused
// whole, never sliced wrongly; a lossless entry that carries blocks, or a layout word no layout
// owns, is refused too.
test('block tails round-trip by layout and dimension, and a column of the wrong length is refused', () => {
  const lossless = {
    ...preview(1, 16, 16, 3),
    layouts: { bc7: 'lossless', astc: 'rgba' } as const,
  };
  lossless.blocks = { bc7: [], astc: lossless.blocks.astc };
  const previews = [preview(0, 40, 24, 1), lossless, preview(2, 8, 8, 5)];
  const { slim, buffer } = encode(previews);
  assert.equal(
    slim.binary.texturePreviewBc7Bytes,
    previewBlockBytes(40, 24) + previewBlockBytes(8, 8),
  );
  assert.equal(
    slim.binary.texturePreviewAstcBytes,
    previewBlockBytes(40, 24) + previewBlockBytes(16, 16) + previewBlockBytes(8, 8),
  );
  const decoded = decodeManifestBinary(slim, buffer).texturePreviews!;
  decoded.forEach((entry, index) => {
    assert.deepEqual(entry.layouts, previews[index].layouts);
    assert.deepEqual(entry.blocks, previews[index].blocks);
  });
  for (const delta of [-16, 16]) {
    const lying = { ...slim, binary: { ...slim.binary } };
    lying.binary.texturePreviewBc7Bytes += delta;
    refused(buffer, lying);
  }
  previewWord(buffer, 1, PREVIEW_LAYOUTS)[0] = 3;
  refused(buffer, slim);
  assert.throws(
    () => encode([{ ...preview(0, 8, 8, 1), blocks: { bc7: [], astc: [] } }]),
    /wrong length/,
  );
  assert.throws(
    () => encode([{ ...preview(0, 8, 8, 1), layouts: { bc7: 'lossless', astc: 'rgba' } }]),
    /lossless texture preview carries blocks/,
  );
});
