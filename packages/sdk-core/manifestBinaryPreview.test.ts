import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, sha } from '../../test/fixtures/manifestBinary.ts';
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
import { previewFirstLevel, previewLevelCount, previewLevelSize } from './texturePreviewLevels.ts';
import {
  COLUMN_NAMES,
  MANIFEST_BINARY_HEADER_WORDS,
  PREVIEW_WORDS,
} from './manifestBinaryFormat.ts';

function levels(width: number, height: number, seed: number) {
  const first = previewFirstLevel(width, height);
  return Array.from({ length: previewLevelCount(width, height) }, (_, index) => {
    const [w, h] = previewLevelSize(width, height, first + index);
    return new Uint8Array(w * h * 4).map((_b, i) => (i + seed) % 256) as Uint8Array<ArrayBuffer>;
  });
}
function preview(texture: number, width: number, height: number, seed: number): TexturePreview {
  return {
    texture,
    image: texture,
    width,
    height,
    sourceKind: 0,
    sourceBufferView: -1,
    sha256: sha(String(texture)),
    firstLevel: previewFirstLevel(width, height),
    levels: levels(width, height, seed),
  };
}
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
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  return { slim, buffer };
}
/** Les mots `texturePreviewU32` de l'entrée `entry`, à même le tampon fini : le seul moyen de
 *  fabriquer un sidecar dont la géométrie ou la plage d'octets ment sans passer par l'encodeur, qui
 *  la refuserait lui-même. */
function previewWord(buffer: ArrayBuffer, entry: number, field: number) {
  const header = new Uint32Array(buffer, 0, MANIFEST_BINARY_HEADER_WORDS + COLUMN_NAMES.length * 2);
  const index = COLUMN_NAMES.indexOf('texturePreviewU32');
  const offset = header[MANIFEST_BINARY_HEADER_WORDS + index * 2];
  return new Uint32Array(buffer, offset + (entry * PREVIEW_WORDS + field) * 4, 1);
}
const PREVIEW_FIRST_LEVEL = 6,
  PREVIEW_PIXEL_OFFSET = 8,
  PREVIEW_PIXEL_BYTES = 9;
function refused(buffer: ArrayBuffer, slim: SlimClusterManifest) {
  assert.throws(
    () => decodeManifestBinary(slim, buffer),
    (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE',
  );
}

// Comportement 5 : un sidecar version 4 fait l'aller-retour, et son lecteur refuse une version 3.
test('a version 3 sidecar (the fixed-length preview entries) is refused, never read as version 4', () => {
  const { slim, buffer } = encode([preview(0, 32, 16, 1)]);
  const header = new Uint32Array(buffer, 0, 2);
  header[1] = 3;
  assert.throws(
    () => decodeManifestBinary(slim, buffer),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
  );
});

// Comportement 5 : la géométrie déclarée est recalculée depuis les dimensions, jamais crue — un
// premier niveau ou une longueur de pixels qui ne s'accordent pas avec elles sont refusés.
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

// Comportement 5 : la plage d'octets d'une entrée doit suivre la précédente sans trou ni
// chevauchement — un décalage qui ment dans un sens ou dans l'autre est refusé.
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
