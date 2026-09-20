import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { TexturePreview } from '../sdk-core/index.ts';
import { previewLevels } from '../../test/fixtures/manifestBinary.ts';
import { tileCatalogue } from './webgpuTileCatalogue.ts';
import { WHITE_BLOCK } from './textureBlockFormats.ts';

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

// Behaviour: under a block format the tails are the sidecar's blocks of that format and the
// fill slot is the proven white block; without one they are the RGBA8 tails, as before.
test('a block catalogue takes the tails of its format from the sidecar', () => {
  const chain = preview(256, 128, 2);
  const [fill, entry] = tileCatalogue([map()], () => chain, reader, 'astc');
  assert.deepEqual(fill.source, { kind: 'bytes', tail: [WHITE_BLOCK.astc] });
  assert.equal(entry.source.kind, 'baked');
  if (entry.source.kind === 'baked') assert.equal(entry.source.tail, chain.blocks.astc);
  const [, rgba] = tileCatalogue([map()], () => chain, reader);
  if (rgba.source.kind === 'baked') assert.equal(rgba.source.tail, chain.levels);
});

// Behaviour: a host image cannot fill a block pool — the caller must have brought the pools back
// to RGBA8 first, and the catalogue refuses rather than pin a tail it cannot write.
test('a texture without a whole chain is refused under a block format, and hosted without one', () => {
  assert.throws(
    () => tileCatalogue([map()], () => undefined, reader, 'bc7'),
    /TEXTURE_HOST_UNDER_BLOCK_POOL/,
  );
  const [, hosted] = tileCatalogue([map()], () => undefined, reader);
  assert.equal(hosted.source.kind, 'host');
});
