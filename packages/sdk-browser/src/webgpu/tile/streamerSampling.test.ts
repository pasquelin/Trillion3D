// #360, #361: a texture's sampling follows its host, not the surfaces that wear it — the records
// brought up at each render, before the hold verdict, then the headers written where a word
// moved, whichever pass reads the texture —, and a moved colour texture is signalled as a landed
// tile is, so the cutout shadows that read it follow and a held image is released.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileStreamer } from './streamer.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { tileLayout } from '../../texture/tiles.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { hostTextureWritten, importHostTexture } from '../../host/textureImport.ts';
import type { HostMaterials, HostTexture } from '../../host/resources.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import { visMaterial } from '../../visibility/shader/material.ts';
import { holdWebgpuFrame, keepWebgpuFrame } from '../frame/hold.ts';
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

/** One image's follow, as `../pages/render/render.ts` runs it before the hold verdict; the
 *  host writes before it are announced, as the engine's writers do (`hostTextureWritten`). */
const follow = async (textures: { followSampling(): boolean }, announced = true) => {
  if (announced) hostTextureWritten();
  await Promise.resolve();
  return textures.followSampling();
};

test('the headers follow their hosts at each render, only what moved written', async () => {
  const colour = host(),
    data = host();
  const colourRecord = record(colour);
  const { textures, writes, signalled } = streamer([colourRecord], record(data));
  const opened = writes();
  await follow(textures);
  assert.equal(writes(), opened, 'nothing moved: nothing written');
  // Three's order as often as the other: `needsUpdate` first, the filter after it.
  colour.needsUpdate = true;
  colour.minFilter = THREE.NearestMipmapNearestFilter;
  colour.anisotropy = 8;
  await follow(textures);
  assert.equal(colourRecord.minFilter, 'nearest-mip-nearest', 'the filter written after it');
  assert.deepEqual(signalled, [[1]], 'the colour slot, as a landed tile');
  assert.equal(writes(), opened + 1);
  await follow(textures);
  assert.equal(writes(), opened + 1, 'the same state: written once');
  // A placement moves no version: the matrix recomposed at the image moves the header.
  data.offset.x = 0.5;
  await follow(textures);
  assert.deepEqual(signalled, [[1], []], 'signalled, no shadow reads a data map');
  assert.equal(writes(), opened + 2, 'one send per atlas that moved');
  // An addressing rides in the header too: written, and the cutout shadows told, as a filter.
  colour.wrapS = THREE.RepeatWrapping;
  await follow(textures);
  assert.deepEqual(signalled, [[1], [], [1]], 'the colour slot, for its cutout shadows');
  assert.equal(writes(), opened + 3);
  textures.destroy();
});

// Review of #389: two engines hold the same record. Each keeps the counters it wrote its header
// at: the second to follow in the image learns the change the first brought up.
test('two engines over the same texture both write the change', async () => {
  const colour = host();
  const shared = record(colour);
  const first = streamer([shared], record(host())),
    second = streamer([shared], record(host()));
  const opened = [first.writes(), second.writes()];
  colour.magFilter = THREE.NearestFilter;
  assert.equal(await follow(first.textures), true, 'a filter rule switched on');
  assert.equal(second.textures.followSampling(), true, 'the second engine learns it too');
  assert.deepEqual([first.writes(), second.writes()], [opened[0] + 1, opened[1] + 1]);
  assert.deepEqual([first.signalled, second.signalled], [[[1]], [[1]]]);
  colour.magFilter = THREE.LinearFilter;
  assert.equal(await follow(first.textures), true, 'switched off: the pages change class');
  colour.wrapS = THREE.RepeatWrapping;
  assert.equal(await follow(first.textures), false, 'an addressing switches no filter rule');
  first.textures.destroy();
  second.textures.destroy();
});

test('the map of a transparent surface alone follows its host, no surface reread', async () => {
  const map = host();
  const surface = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5, map });
  const read = visMaterial(surface as unknown as HostMaterials).map!;
  const { textures, signalled } = streamer([read], record(host()));
  map.magFilter = THREE.NearestFilter;
  map.wrapT = THREE.MirroredRepeatWrapping;
  await follow(textures);
  assert.deepEqual([read.magFilter, read.wrapT], ['nearest', 'mirror'], 'the item’s record');
  assert.deepEqual(signalled, [[1]]);
  textures.destroy();
});

test('a filter changed on a held image releases it, and the image draws it', async () => {
  const colour = host();
  const rt = settledRt();
  const { textures } = streamer([record(colour)], record(host()), () =>
    rt.run.gate.resourcesChanged(),
  );
  const device = {} as GPUDevice;
  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  await follow(textures);
  assert.equal(holdWebgpuFrame(rt, device), true, 'nothing moved: the image is held');
  colour.magFilter = THREE.NearestFilter;
  await follow(textures);
  assert.equal(holdWebgpuFrame(rt, device), false, 'the next image is drawn');
  textures.destroy();
});

// #402: the follow walked every slot and read every host at every image, held or not.
test('a still image reads no host and walks no slot', async () => {
  const colour = host();
  const { textures, writes } = streamer([record(colour)], record(host()));
  await follow(textures);
  const opened = writes();
  let reads = 0;
  const { magFilter } = colour;
  Object.defineProperty(colour, 'magFilter', {
    get: () => (reads++, magFilter),
    configurable: true,
  });
  for (let image = 0; image < 3; image++) await follow(textures, false);
  assert.equal(reads, 0, 'nothing announced: nothing read');
  await follow(textures);
  assert.ok(reads > 0, 'an announced write is read at the next image');
  assert.equal(writes(), opened, 'and nothing moved: nothing written');
  textures.destroy();
});
