// #362: the WebGPU working texture of a page texture is uploaded the way the WebGL2 binder uploads
// it (`UNPACK_FLIP_Y_WEBGL`) and three's Texture reads it: a canvas, a video frame or a turned and
// tiled picture, `flipY` by default, lands with its last row at v = 0; a picture that says
// `flipY: false` (a decoded glTF image, raw texels) lands as it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileScratch } from './scratch.ts';
import { texture } from '../../world/texture/index.ts';
import { hostTexture } from '../../world/core/worldTextures.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';

type Copy = { source: { source: unknown; flipY?: boolean } };

/** Uploads a page texture through the engine's own chain — its surface texture, its record — into
 *  a working texture; returns the external copies and the texel rows written. */
function upload(page: Texture, [width, height]: [number, number]) {
  installGpuGlobals();
  const { device } = mockGpu();
  const copies: Copy[] = [],
    rows: Uint8Array[] = [];
  Object.assign(device.queue, {
    copyExternalImageToTexture: (source: Copy['source']) => copies.push({ source }),
    writeTexture: (_to: unknown, data: Uint8Array) => rows.push(new Uint8Array(data)),
  });
  const map = importHostTexture(hostTexture(page, true, new Map()));
  createTileScratch(device, { map, width, height, format: 'rgba8unorm', errorCode: 'NONE' });
  return { copies, rows };
}

test('a canvas is copied with its rows flipped, as the WebGL2 upload does', () => {
  const canvas = { width: 1, height: 1 } as HTMLCanvasElement;
  const { copies } = upload(texture.canvas(canvas), [1, 1]);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].source.source, canvas);
  assert.equal(copies[0].source.flipY, true);
});

test('a video frame is copied with its rows flipped', () => {
  const video = {
    videoWidth: 1,
    videoHeight: 1,
    paused: true,
    ended: false,
    addEventListener() {},
  } as unknown as HTMLVideoElement;
  const { copies } = upload(texture.video(video), [1, 1]);
  assert.equal(copies[0].source.flipY, true);
});

test('a turned, tiled picture is flipped at upload, its placement left to the sampler', () => {
  const canvas = { width: 1, height: 1 } as HTMLCanvasElement;
  const tile = texture.canvas(canvas);
  tile.wrap = 'repeat';
  tile.repeat.set(4, 4);
  tile.rotation = Math.PI / 6;
  const { copies } = upload(tile, [1, 1]);
  assert.equal(copies[0].source.flipY, true);
});

test('a picture that says flipY false is copied as it is', () => {
  const canvas = { width: 1, height: 1 } as HTMLCanvasElement;
  const kept = texture.canvas(canvas);
  kept.flipY = false;
  assert.equal(upload(kept, [1, 1]).copies[0].source.flipY, false);
});

test('raw texels are written as they are, or rows reversed when flipY is asked', () => {
  // Two rows of one texel: red first, blue last.
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
  const kept = texture.data(pixels, 1, 2);
  assert.deepEqual([...upload(kept, [1, 2]).rows[0]], [...pixels]);
  const flipped = texture.data(pixels, 1, 2);
  flipped.flipY = true;
  assert.deepEqual([...upload(flipped, [1, 2]).rows[0]], [0, 0, 255, 255, 255, 0, 0, 255]);
});
