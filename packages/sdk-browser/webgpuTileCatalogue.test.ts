import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { TexturePreview } from '../sdk-core/index.ts';
import { previewLevels } from '../../test/fixtures/manifestBinary.ts';
import { tileCatalogue } from './webgpuTileCatalogue.ts';
import { WHITE_TAIL } from './textureBlockFormats.ts';

const preview = (width: number, height: number, bakedLevels: number): TexturePreview => ({
  texture: 0,
  image: 0,
  width,
  height,
  sourceKind: 0,
  sourceBufferView: -1,
  sha256: 'a'.repeat(64),
  atlas: 0,
  firstLevel: bakedLevels,
  bakedLevels,
  ...previewLevels(width, height, 3),
});
const map = () => {
  const texture = new THREE.Texture();
  texture.image = { data: new Uint8Array(4 * 4 * 4), width: 4, height: 4 };
  return texture;
};
const reader = async () => {
  throw new Error('never read here');
};

// Behaviour: the catalogue is encoding-agnostic — a tail carries every encoding the sidecar
// holds, the fill slot the white texel in each, and the atlas pins the one its pool samples; a
// texture without a whole chain is hosted, which prepare reads to settle the block choice.
test('a catalogue carries whole tails in every encoding and hosts what has no chain', () => {
  const chain = preview(256, 128, 2);
  const [fill, entry, hosted] = tileCatalogue(
    [map(), map()],
    (i) => (i === 0 ? chain : undefined),
    reader,
  );
  assert.deepEqual(fill.source, { kind: 'bytes', tail: WHITE_TAIL });
  assert.equal(entry.source.kind, 'baked');
  if (entry.source.kind === 'baked') assert.equal(entry.source.tail, chain);
  assert.equal(hosted.source.kind, 'host');
  const [, small] = tileCatalogue([map()], () => preview(32, 32, 0), reader);
  assert.equal(small.source.kind, 'bytes');
});
