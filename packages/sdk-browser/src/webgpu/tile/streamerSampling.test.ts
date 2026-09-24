// #360, #361: a texture's sampling follows its host, not the surfaces that wear it — compared
// with its header once per image, before the hold verdict, whichever pass reads the texture —,
// and a moved colour texture is signalled as a landed tile is, so the cutout shadows that read it
// follow and a held image is released.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileStreamer } from './streamer.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { tileLayout } from '../../texture/tiles.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { importHostTexture } from '../../host/surfaceImport.ts';
import type { HostMaterials, HostTexture } from '../../host/resources.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import { visMaterial } from '../../visibility/shader/material.ts';
import { followHostTextures, holdWebgpuFrame, keepWebgpuFrame } from '../frame/hold.ts';
import { settledRt } from '../frame/hold.fixture.ts';
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
function streamer(colours: Texture[], data: Texture, onColour = () => {}) {
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
  const lossless = { lossless: 2, rgba: 0, 'two-channel': 0 };
  const textures = createWebgpuTileStreamer({
    device,
    color: [whole(), ...colours.map(whole)],
    data: [whole(), whole(data)],
    layers: { color: lossless, data: lossless },
    encoding: poolEncoding(undefined),
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetMs: Number.MAX_SAFE_INTEGER,
    onFailure: (phase, error) => assert.fail(`${phase}: ${String(error)}`),
    onColorChanged: (slots) => {
      signalled.push(slots === -1 ? [-1] : [...slots]);
      onColour();
    },
  });
  textures.prepare();
  return { textures, writes: () => tableWrites, signalled };
}

test('the sampling follows its host at every image, a filter written after needsUpdate included', () => {
  const colour = host(),
    data = host();
  const colourRecord = record(colour);
  const { textures, writes, signalled } = streamer([colourRecord], record(data));
  const opened = writes();
  assert.equal(textures.followSampling(), false);
  assert.equal(writes(), opened, 'nothing moved: nothing written');
  // Three's order as often as the other: `needsUpdate` first, the filter after it.
  colour.needsUpdate = true;
  colour.minFilter = THREE.NearestMipmapNearestFilter;
  colour.anisotropy = 8;
  textures.followSampling();
  assert.equal(colourRecord.minFilter, 'nearest-mip-nearest', 'the filter written after it');
  assert.deepEqual(signalled, [[1]], 'the colour slot, as a landed tile');
  assert.equal(writes(), opened + 1);
  textures.followSampling();
  assert.equal(writes(), opened + 1, 'the same state: written once');
  // A placement moves no version: the matrix recomposed at the image moves the header.
  data.offset.x = 0.5;
  textures.followSampling();
  assert.deepEqual(signalled, [[1], []], 'signalled, no shadow reads a data map');
  assert.equal(writes(), opened + 2, 'one send per atlas that moved');
  textures.followSampling();
  assert.equal(writes(), opened + 2, 'the same placement: nothing written');
  // An addressing lives in the page rows, not in the header: said, not written.
  data.wrapS = THREE.RepeatWrapping;
  data.needsUpdate = true;
  assert.equal(textures.followSampling(), true, 'the addressing moved');
  assert.equal(writes(), opened + 2);
  textures.destroy();
});

test('the map of a transparent surface alone follows its host, no surface reread', () => {
  const map = host();
  const surface = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5, map });
  const read = visMaterial(surface as unknown as HostMaterials).map!;
  const { textures, signalled } = streamer([read], record(host()));
  map.magFilter = THREE.NearestFilter;
  map.needsUpdate = true;
  textures.followSampling();
  assert.equal(read.magFilter, 'nearest', 'the record the transparent item holds');
  assert.deepEqual(signalled, [[1]]);
  textures.destroy();
});

test('a filter changed on a held image releases it, and the image draws it', () => {
  const colour = host();
  const rt = settledRt();
  const { textures } = streamer([record(colour)], record(host()), () =>
    rt.run.gate.resourcesChanged(),
  );
  Object.assign(rt.vis, { textures });
  const device = {} as GPUDevice;
  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  followHostTextures(rt);
  assert.equal(holdWebgpuFrame(rt, device), true, 'nothing moved: the image is held');
  colour.needsUpdate = true;
  colour.magFilter = THREE.NearestFilter;
  followHostTextures(rt);
  assert.equal(holdWebgpuFrame(rt, device), false, 'the next image is drawn');
  // An addressing moved: the page rows that fold it are written again.
  const { rows } = rt.layout as unknown as { rows: { tableEpoch: number } },
    epoch = rows.tableEpoch;
  colour.wrapT = THREE.MirroredRepeatWrapping;
  colour.needsUpdate = true;
  followHostTextures(rt);
  assert.equal(rows.tableEpoch, epoch + 1, 'the page rows written again');
  textures.destroy();
});

// The cost of the walk, paid at every image, held or not: 1 000 textures, nothing moved — the
// matrix recomposed, the words compared. Printed, bounded loosely so a slow machine passes.
test('the walk over 1 000 textures costs microseconds per image', (t) => {
  const records = Array.from({ length: 1000 }, () => record(host()));
  const { textures } = streamer(records, record(host()));
  for (let i = 0; i < 200; i++) textures.followSampling();
  const images = 2000,
    started = performance.now();
  for (let i = 0; i < images; i++) textures.followSampling();
  const perImage = ((performance.now() - started) / images) * 1000;
  t.diagnostic(`followSampling, 1 000 textures: ${perImage.toFixed(1)} µs per image`);
  assert.ok(perImage < 2000);
  textures.destroy();
});
