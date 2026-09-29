import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bundlePage, dansPageWebgpu } from './pageWebgpu.ts';
declare global {
  var rectPhysical: typeof import('./rect-physical-page.ts');
}
if (import.meta.main)
  test('rectangle anisotropy rotates the lobe and clearcoat contributes its own roughness', async () => {
    const script = await bundlePage(
      fileURLToPath(new URL('./rect-physical-page.ts', import.meta.url)),
      'rectPhysical',
    );
    const { values, error } = await dansPageWebgpu(() => globalThis.rectPhysical.run(), null, {
      script,
    });
    assert.equal(error, 0);
    assert.ok(values.every(Number.isFinite));
    assert.deepEqual(
      values.slice(0, 4),
      values.slice(4, 8),
      'zero anisotropy is frame-independent',
    );
    assert.ok(
      Math.abs(values[8] - values[12]) > 1e-4,
      'rotating anisotropy changes rectangular integration',
    );
    assert.ok(values[16] > 0 && values[20] > 0, 'coat illuminates a black metallic base');
    assert.ok(Math.abs(values[16] - values[20]) > 1e-4, 'coat roughness shapes its own lobe');
  });
