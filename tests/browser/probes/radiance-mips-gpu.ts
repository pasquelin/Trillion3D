// Arithmetic diagnosis only, without image comparison or frame timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bundlePage, dansPageWebgpu } from './pageWebgpu.ts';

declare global {
  var radianceMips: typeof import('./radiance-mips-page.ts');
  var reflectionBounds: typeof import('./reflection-bounds-page.ts');
}

if (import.meta.main)
  test('radiance mip reduction preserves HDR means, alpha and odd-edge energy', async () => {
    const script = await bundlePage(
      fileURLToPath(new URL('./radiance-mips-page.ts', import.meta.url)),
      'radianceMips',
    );
    const result = await dansPageWebgpu(() => globalThis.radianceMips.run(), null, { script });
    assert.deepEqual(result.errors, []);
    const counts = [0, 35, 9, 9];
    for (let row = 0; row < counts.length; row++) {
      const count = counts[row];
      const expected = count
        ? [1 + 15 / count, 2 + 30 / count, 4 + 60 / count, 1 - 1 / count]
        : [1, 2, 4, 1];
      result.values[row].forEach((value, channel) => {
        assert.ok(
          Math.abs(value - expected[channel]) <= expected[channel] / 512,
          `${row}/${channel}: ${value} vs ${expected[channel]}`,
        );
      });
    }
  });

if (import.meta.main)
  test('depth bounds retain both extrema, discard empty depth and include odd borders', async () => {
    const script = await bundlePage(
      fileURLToPath(new URL('./reflection-bounds-page.ts', import.meta.url)),
      'reflectionBounds',
    );
    const result = await dansPageWebgpu(() => globalThis.reflectionBounds.run(), null, { script });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.values, [
      [0.25, 0.875],
      [0.25, 0.875],
      [0.25, 0.875],
    ]);
  });
