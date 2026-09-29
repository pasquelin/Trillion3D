import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bundlePage, dansPageWebgpu } from './pageWebgpu.ts';

declare global {
  var physicalMaps: typeof import('./physical-maps-page.ts');
}

if (import.meta.main)
  test('native-size physical arrays match native samplers across filtering and seams', async () => {
    const script = await bundlePage(
      fileURLToPath(new URL('./physical-maps-page.ts', import.meta.url)),
      'physicalMaps',
    );
    const result = await dansPageWebgpu(() => globalThis.physicalMaps.run(), null, { script });
    assert.deepEqual(result.errors, Array(18).fill(0));
    for (const difference of result.differences)
      assert.ok(Number.isFinite(difference) && difference <= 2 / 255, String(result.differences));
  });
