// #43: the WebGPU working texture writes texels held in memory as RGBA8, one byte per channel of
// four. Texels stored otherwise — three channels, one, floats, or fewer bytes than the size holds —
// are refused by name, in the words the WebGL2 gate refuses them with (`texelsReason`), never
// written as RGBA8 to draw wrong or fail the device's validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileScratch } from './scratch.ts';
import { texture } from '../../world/texture/index.ts';
import { hostTexture } from '../../world/core/worldTextures.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';

/** Fills a 2×2 working texture from raw texels through the engine's own chain; the rows written. */
function fill(...texels: Parameters<typeof texture.data>) {
  installGpuGlobals();
  const { device } = mockGpu();
  const rows: Uint8Array[] = [];
  Object.assign(device.queue, {
    writeTexture: (_to: unknown, data: Uint8Array) => rows.push(new Uint8Array(data)),
  });
  const map = importHostTexture(hostTexture(texture.data(...texels), true, new Map()));
  createTileScratch(device, { map, width: 2, height: 2, format: 'rgba8unorm', errorCode: 'NONE' });
  return rows;
}

test('2×2 RGBA8 texels are written as they are', () => {
  const pixels = Uint8Array.from({ length: 16 }, (_, i) => i);
  assert.deepEqual([...fill(pixels, 2, 2)[0]], [...pixels]);
});

test('texels the RGBA8 working texture cannot hold as stored are refused by name', () => {
  const refused: [string, ...Parameters<typeof texture.data>][] = [
    ['texel format 1022 is unsupported: RGBA only', new Uint8Array(12), 2, 2, 'rgb'],
    ['texel format 1028 is unsupported: RGBA only', new Uint8Array(4), 2, 2, 'r'],
    ['texel storage is unsupported: 8-bit texels only', new Float32Array(16), 2, 2],
    ['texel storage holds 8 bytes, not 2×2 RGBA', new Uint8Array(8), 2, 2],
  ];
  for (const [message, ...texels] of refused) assert.throws(() => fill(...texels), { message });
});
