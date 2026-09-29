// Numeric GLSL diagnostic, never an image or timing proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bundlePage, dansPageWebgpu } from './pageWebgpu.ts';

declare global {
  var reflectionGl: typeof import('./reflection-gl-page.ts');
}

if (import.meta.main)
  test('complete GLSL reflection program and exact odd-size radiance/depth hierarchy', async () => {
    const script = await bundlePage(
      fileURLToPath(new URL('./reflection-gl-page.ts', import.meta.url)),
      'reflectionGl',
    );
    const result = await dansPageWebgpu(() => globalThis.reflectionGl.run(), null, { script });
    assert.equal(result.reductionError, 0);
    assert.equal(result.error, 0);
    assert.ok(Math.abs(result.values[0] - (1 + 15 / 35)) < 0.003);
    assert.ok(Math.abs(result.values[1] - (1 - 1 / 35)) < 0.002);
    assert.ok(Math.abs(result.values[2] - 0.25) < 1e-6);
    assert.ok(Math.abs(result.values[3] - 0.875) < 1e-6);
  });
