// #360, #361: a texture's sampling follows its record, not the surfaces that wear it — once per
// revision the import names, whichever pass reads the texture —, and a moved colour texture is
// signalled as a landed tile is, so the cutout shadows that read it follow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileStreamer } from './streamer.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { tileLayout } from '../../texture/tiles.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { importHostTexture } from '../../host/surfaceImport.ts';
import type { HostTexture } from '../../host/resources.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import * as THREE from 'three';

installGpuGlobals();

/** A host texture at the default sampling. */
const host = () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
};
const record = (texture: THREE.Texture) => importHostTexture(texture as unknown as HostTexture);

/** A streamer over one colour and one data texture, both whole in their tail; counts the page
 *  table writes and the colour signals. */
function streamer(colour: Texture, data: Texture) {
  let tableWrites = 0;
  const signalled: number[][] = [];
  const device = {
    createTexture: () => ({ createView: () => ({}), destroy() {}, format: 'rgba8unorm' }),
    createBuffer: ({ size, label }: { size: number; label?: string }) => ({
      label,
      size,
      destroy() {},
    }),
    createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: {
      writeTexture() {},
      submit() {},
      writeBuffer: (buffer: { label?: string }) => {
        if (buffer.label?.startsWith('Trillion3D texture pages')) tableWrites++;
      },
    },
  } as never;
  const blocks = { bc7: [], astc: [] };
  const whole = (texture?: Texture) => ({
    layout: tileLayout(1, 1),
    lane: 'lossless' as const,
    source: { kind: 'bytes' as const, tail: { levels: [new Uint8Array(4)], blocks } },
    texture,
  });
  const lossless = { lossless: 1, rgba: 0, 'two-channel': 0 };
  const textures = createWebgpuTileStreamer({
    device,
    color: [whole(), whole(colour)],
    data: [whole(), whole(data)],
    layers: { color: lossless, data: lossless },
    encoding: poolEncoding(undefined),
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetMs: Number.MAX_SAFE_INTEGER,
    onFailure: (phase, error) => assert.fail(`${phase}: ${String(error)}`),
    onColorChanged: (slots) => signalled.push(slots === -1 ? [-1] : [...slots]),
  });
  textures.prepare();
  return { textures, writes: () => tableWrites, signalled };
}

test('the sampling follows the records the import revised, and signals a moved colour texture', () => {
  const colour = host(),
    data = host();
  const { textures, writes, signalled } = streamer(record(colour), record(data));
  const opened = writes();
  textures.followSampling();
  assert.equal(writes(), opened, 'nothing revised: nothing written');
  // The host bumps the version on `needsUpdate` alone, no material told: the record follows it.
  colour.anisotropy = 8;
  colour.needsUpdate = true;
  textures.followSampling();
  assert.deepEqual(signalled, [[1]], 'the colour slot, as a landed tile');
  assert.equal(writes(), opened + 1);
  textures.followSampling();
  assert.equal(writes(), opened + 1, 'the same revision: written once');
  // A placement moves no version: the read that recomposes its matrix names the record.
  data.offset.x = 0.5;
  record(data);
  textures.followSampling();
  assert.deepEqual(signalled, [[1], []], 'signalled, no shadow reads a data map');
  assert.equal(writes(), opened + 2, 'one send per atlas that moved');
  record(data);
  textures.followSampling();
  assert.equal(writes(), opened + 2, 'the same placement: nothing named');
  textures.destroy();
});
