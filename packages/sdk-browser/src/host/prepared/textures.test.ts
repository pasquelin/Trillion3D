import test from 'node:test';
import assert from 'node:assert/strict';
import { preparedTextures, type TextureRanks } from './textures.ts';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';

// Issue #275: a texture whose only image is an `EXT_texture_webp` one reads the image the table
// names — the compiler carries the extension's source — as the host loader reads it.
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

// A slot naming another coordinate set than the first reads a copy of its texture, which answers to
// no rank; a copy a transform alone made — or one sent to another set — keeps its texture's rank.
test('a slot reading another set or moved reads a copy, ranked unless the slot named its own set', async () => {
  const tables = {
    textures: [
      {
        name: '',
        sampler: null,
        image: 0,
        wrapS: 'repeat',
        wrapT: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear-mip-linear',
      },
    ],
  } as unknown as PreparedSceneTables;
  const document = {
    images: [{ uri: 'a.png', view: null, mimeType: null, name: '' }],
  } as unknown as TableDocument;
  const ranks: TextureRanks = new Map();
  const slot = preparedTextures(
    tables,
    document,
    () => Promise.resolve({ width: 1, height: 1 }),
    ranks,
  );
  type Offset = readonly [number, number] | null;
  const at = (texCoord: number, slotTexCoord: number, offset: Offset = null) =>
    slot({
      texture: 0,
      texCoord,
      slotTexCoord,
      transform: { offset, rotation: null, scale: null },
    });
  const plain = (await slot({ texture: 0, texCoord: 0, slotTexCoord: 0, transform: null }))!;
  assert.equal(ranks.get(plain), 0);
  const cases: [number, number, Offset, number | undefined][] = [
    [0, 1, null, undefined], // its own set 1 sent back to 0
    [1, 0, null, 0], // its own set 0 sent to 1
    [1, 1, null, undefined], // its own set 1 named again
    [0, 0, [0.25, 0.5], 0], // its own set 0, moved
  ];
  for (const [texCoord, slotTexCoord, offset, rank] of cases) {
    const texture = (await at(texCoord, slotTexCoord, offset))!;
    const name = `set ${slotTexCoord} read as ${texCoord}${offset ? ', moved' : ''}`;
    assert.notEqual(texture, plain, `${name}: a copy`);
    assert.equal(texture.channel, texCoord, name);
    assert.equal(ranks.get(texture), rank, name);
    if (offset) assert.deepEqual([texture.offset.x, texture.offset.y], offset, name);
  }
  assert.equal(await at(0, 0), plain, 'its own set, unmoved: the texture itself');
});
