import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureLevelReader } from './levelReader.ts';

const SHA = 'b'.repeat(64);
const manifest = {
  textures: { url: '../../textures/v6/{sha}/{kind}-{level}.{format}', version: 6 },
  key: 'k1',
};

/** A fetch that serves what the test gives it, and records the address asked. */
function serve(bytes: Uint8Array<ArrayBuffer>) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    asked.push(String(url));
    return new Response(bytes, { status: 200 });
  }) as typeof fetch;
  return asked;
}

// Behaviour: a block level is read as the bytes the file holds, at the address of its format —
// the level store checks their length; a lossless level goes through the
// browser's decoder.
test('a block level is read as bytes at the address of its format', async () => {
  globalThis.createImageBitmap ??= (() => Promise.reject(new Error('unused'))) as never;
  const reader = createTextureLevelReader(manifest, 'https://host/cache/full/clusters.json')!;
  const asked = serve(new Uint8Array(17 * 3 * 16));
  const level = await reader({ sha256: SHA, atlas: 1, level: 1, format: 'bc7' });
  assert.equal(asked[0], `https://host/textures/v6/${SHA}/linear-1.bc7`);
  assert.ok(level instanceof Uint8Array);
  assert.equal(level.byteLength, 816);
});

// #962: a cache whose levels are of another version — row-major block files before 6 — is refused
// at each read, nothing asked, never cut as tile records.
test('a level of another version is refused', async () => {
  const asked = serve(new Uint8Array(16));
  const reader = createTextureLevelReader(
    { ...manifest, textures: { url: manifest.textures.url } },
    'https://host/',
  )!;
  await assert.rejects(
    reader({ sha256: SHA, atlas: 0, level: 0, format: 'bc7' }),
    /another version/,
  );
  assert.deepEqual(asked, []);
});
