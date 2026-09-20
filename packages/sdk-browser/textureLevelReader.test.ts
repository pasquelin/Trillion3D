import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureLevelReader } from './textureLevelReader.ts';

const SHA = 'b'.repeat(64);
const textures = { url: '../../textures/v4/{sha}/{kind}-{level}.{format}' };

/** A fetch that serves what the test gives it, and records the address asked. */
function serve(bytes: Uint8Array) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    asked.push(String(url));
    return new Response(bytes, { status: 200 });
  }) as typeof fetch;
  return asked;
}

// Behaviour: a block level is read as bytes, at the address of its format, and checked against
// the length its dimensions imply — a short or long file is refused, never copied as whole.
test('a block level is read as bytes and its length checked against the level geometry', async () => {
  globalThis.createImageBitmap ??= (() => Promise.reject(new Error('unused'))) as never;
  const reader = createTextureLevelReader(textures, 'https://host/cache/full/clusters.json')!;
  // Level 1 of a 130×20 source is 65×10: 17 × 3 blocks.
  const asked = serve(new Uint8Array(17 * 3 * 16));
  const level = await reader({
    sha256: SHA,
    atlas: 1,
    level: 1,
    format: 'bc7',
    width: 130,
    height: 20,
  });
  assert.equal(asked[0], `https://host/textures/v4/${SHA}/linear-1.bc7`);
  assert.ok('blocks' in level);
  assert.deepEqual([level.width, level.height, level.blocks.byteLength], [65, 10, 816]);
  serve(new Uint8Array(800));
  await assert.rejects(
    reader({ sha256: SHA, atlas: 1, level: 1, format: 'astc', width: 130, height: 20 }),
    /TEXTURE_LEVEL_BYTES/,
  );
});
