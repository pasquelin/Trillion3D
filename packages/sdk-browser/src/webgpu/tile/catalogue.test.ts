import { importHostTexture } from '../../host/textureImport.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { TexturePreview } from '../../../../sdk-core/src/index.ts';
import { previewLevels } from '../../../../../tests/fixtures/manifestBinary.ts';
import { tileCatalogue } from './catalogue.ts';
import { poolEncoding, WHITE_TAIL } from '../../texture/blockFormats.ts';

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
  return importHostTexture(texture);
};
const reader = async () => {
  throw new Error('never read here');
};

// Behaviour: a tail carries every encoding the sidecar holds, the fill slot the white texel in
// each, and every texture takes the lane of its chain's layout in the session's family — the
// lossless one where the gate refused it, without a family, or hosted for want of a whole
// chain; the fill sits in the family's RGBA lane when a chain is kept there, else in any lane
// the textures already open.
test('a catalogue routes each texture to the lane of its layout and hosts what has no chain', () => {
  const chain = preview(256, 128, 2);
  const bc7 = poolEncoding('bc7');
  const [fill, entry, hosted] = tileCatalogue(
    [map(), map()],
    (i) => (i === 0 ? chain : undefined),
    reader,
    bc7,
  );
  assert.deepEqual(fill, {
    layout: fill.layout,
    lane: 'rgba',
    source: { kind: 'bytes', tail: WHITE_TAIL },
  });
  assert.equal(entry.source.kind, 'baked');
  assert.equal(entry.lane, 'rgba');
  if (entry.source.kind === 'baked') assert.equal(entry.source.tail, chain);
  assert.deepEqual([hosted.source.kind, hosted.lane], ['host', 'lossless']);
  const [astcFill, astc] = tileCatalogue([map()], () => chain, reader, poolEncoding('astc'));
  assert.equal(astc.lane, 'two-channel');
  assert.equal(astcFill.lane, 'two-channel', 'the fill opens no RGBA layer of its own');
  const refused = { ...chain, layouts: { bc7: 'lossless', astc: 'rgba' } as const };
  const [, lossless] = tileCatalogue([map()], () => refused, reader, bc7);
  assert.equal(lossless.lane, 'lossless');
  const [hostFill, host] = tileCatalogue([map()], () => undefined, reader, bc7);
  assert.deepEqual(
    [hostFill.lane, host.lane],
    ['lossless', 'lossless'],
    'a host-only scene opens no block layer for the fill alone',
  );
  const raw = poolEncoding(undefined);
  const [rawFill, small] = tileCatalogue([map()], () => preview(32, 32, 0), reader, raw);
  assert.deepEqual(
    [rawFill.lane, small.source.kind, small.lane],
    ['lossless', 'bytes', 'lossless'],
  );
});
