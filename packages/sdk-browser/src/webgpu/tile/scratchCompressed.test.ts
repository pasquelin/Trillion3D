import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileScratch } from './scratch.ts';
import { texture } from '../../world/texture/index.ts';
import { hostTexture } from '../../world/core/worldTextures.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { tileCatalogue } from './catalogue.ts';
import { poolEncoding, WHITE_TAIL } from '../../texture/blockFormats.ts';

test('compressed page pictures reach the native upload and GPU scratch without a pixel decode', () => {
  installGpuGlobals();
  const gpu = mockGpu();
  Object.defineProperty(gpu.device, 'features', { value: new Set(['texture-compression-bc']) });
  const bytes = new Uint8Array([0, 248, 31, 0, 0, 0, 0, 0]);
  const page = texture.compressed([{ width: 4, height: 4, data: bytes }], 4, 4, 'bc1-rgba-unorm');
  const map = importHostTexture(hostTexture(page, true, new Map()));
  const uploaded: Uint8Array[] = [];
  gpu.device.queue.writeTexture = (_, data) => {
    uploaded.push(new Uint8Array(data as Uint8Array));
  };
  const scratch = createTileScratch(gpu.device, {
    map,
    width: 4,
    height: 4,
    format: 'rgba8unorm-srgb',
    errorCode: 'UNAVAILABLE',
  });
  assert.deepEqual(uploaded, [bytes]);
  assert.equal(gpu.imageCopies.length, 0);
  const blocks = gpu.textures.find((t) => t.format === 'bc1-rgba-unorm');
  assert.ok(blocks);
  assert.equal(blocks.destroyed, true, 'temporary native source released after queue submission');
  assert.ok(gpu.renderPipelines.some((p) => p.fragment?.entryPoint === 'copyBlocks'));
  const fallback = { ...WHITE_TAIL, width: 4, height: 4, firstLevel: 0, bakedLevels: 0 } as never;
  const [, entry] = tileCatalogue([map], () => fallback, undefined, poolEncoding('bc7'));
  assert.equal(
    entry.source.kind,
    'host',
    'native source takes precedence over the cooked fallback',
  );
  assert.equal(entry.lane, 'lossless');
  scratch.destroy();
});
