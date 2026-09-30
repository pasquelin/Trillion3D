import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { preparedImages } from './images.ts';
import { unmetered } from '../../cluster/byteMeter.ts';
import { decodingImages } from './decodedImages.fixture.ts';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { compressedImage } from '../../../../sdk-core/src/texture/compressed.ts';

const document = {
  images: [
    {
      uri: 'source.dds',
      view: null,
      mimeType: 'image/vnd.ms-dds',
      compressed: {
        uri: 'native.bin',
        blockFormat: 'bc1-rgba-unorm',
        transfer: 'srgb',
        levels: [{ width: 4, height: 4, offset: 0, length: 8 }],
      },
    },
  ],
  views: [],
} as unknown as TableDocument;

function fixture(
  t: TestContext,
  bytes: Uint8Array<ArrayBuffer>,
  supported: boolean,
  missing = false,
  maxTextureDimension2D?: number,
) {
  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
    asked.push(String(url));
    return String(url).endsWith('native.bin') && missing
      ? new Response(null, { status: 404 })
      : new Response(bytes);
  });
  decodingImages(t);
  const read = preparedImages({
    document,
    maxTextureDimension2D,
    documentUrl: 'https://cache.test/source.gltf',
    binary: async () => new ArrayBuffer(0),
    skipped: new Set([0]),
    signal: undefined,
    track: (_, promise) => promise,
    meter: unmetered,
    features: new Set(supported ? ['texture-compression-bc'] : []),
  });
  return { read, asked };
}

test('a supported prepared image loads original blocks even when a pixel fallback is baked', async (t) => {
  const bytes = new Uint8Array([0, 248, 31, 0, 0, 0, 0, 0]);
  const { read, asked } = fixture(t, bytes, true);
  const image = compressedImage(await read(0))!;
  assert.equal(image.blockFormat, 'bc1-rgba-unorm');
  assert.deepEqual([...(image.mipmaps[0].data as Uint8Array)], [...bytes]);
  assert.deepEqual(asked, ['https://cache.test/native.bin']);
  assert.equal(await read(0), image);
});

test('a GPU without compression retains the existing baked pixel fallback', async (t) => {
  const { read, asked } = fixture(t, new Uint8Array([1, 2, 3]), false);
  assert.deepEqual(await read(0), { width: 1, height: 1, bytes: 3 });
  assert.ok(asked[0].startsWith('data:image/png;'));
});

for (const broken of ['missing', 'truncated']) {
  test(`a ${broken} native block product retains the baked fallback`, async (t) => {
    const { read, asked } = fixture(t, new Uint8Array([1, 2, 3]), true, broken === 'missing');
    assert.deepEqual(await read(0), { width: 1, height: 1, bytes: 3 });
    assert.equal(asked[0], 'https://cache.test/native.bin');
    assert.ok(asked[1].startsWith('data:image/png;'));
  });
}

test('a source larger than the device limit retains its cooked tile fallback', async (t) => {
  const { read, asked } = fixture(t, new Uint8Array(8), true, false, 2);
  assert.deepEqual(await read(0), { width: 1, height: 1, bytes: 8 });
  assert.ok(asked[1].startsWith('data:image/png;'));
});
