import test from 'node:test';
import assert from 'node:assert/strict';
import { preparedTextures } from './textures.ts';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';

// Issue #275: a texture whose only image is an `EXT_texture_webp` one reads the image the table
// names — the compiler carries the extension's source — as the reference loader read it.
test('a texture reads the image rank its table row names, a WebP-only one included', async () => {
  const tables = {
    textures: [
      {
        name: '',
        sampler: null,
        image: 1,
        wrapS: 'repeat',
        wrapT: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear-mip-linear',
      },
    ],
  } as unknown as PreparedSceneTables;
  const document = {
    images: [
      { uri: 'a.png', view: null, mimeType: null, name: '' },
      { uri: 'b.webp', view: null, mimeType: 'image/webp', name: '' },
    ],
  } as unknown as TableDocument;
  const read: number[] = [];
  const slot = preparedTextures(
    tables,
    document,
    (rank) => (read.push(rank), Promise.resolve({ width: 1, height: 1 })),
    new Map(),
  );
  const texture = await slot({ texture: 0, texCoord: 0, slotTexCoord: 0, transform: null });
  assert.deepEqual(read, [1]);
  assert.equal(texture?.name, 'b.webp');
});
