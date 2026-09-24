// A backend closed while it prepares: cancelled at its next wait, nothing left on the world's device;
// one on a device lost before its first claim: failed at the end of its preparation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { quadBackend } from '../testScenes.fixture.ts';

test('a backend closed while it prepares stops there, and leaves nothing on the device', async () => {
  installGpuGlobals();
  const { device, textures } = mockGpu();
  const phases: string[] = [];
  const { fixture, backend } = quadBackend(device, { onDiagnostic: (e) => phases.push(e.phase) });
  const preparing = backend.prepare();
  // Closed at its first wait: what it builds from there is destroyed as the rest was.
  const closing = backend.dispose();
  await assert.rejects(preparing, { name: 'AbortError' });
  await closing;
  assert.ok(textures.length > 0);
  assert.deepEqual(
    textures.filter((texture) => !texture.destroyed).map((texture) => texture.label),
    [],
  );
  assert.ok(!phases.includes('webgpu-prepare-failed'), 'cancelled, not failed');
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test("a session's first claim on a device already lost fails its preparation", async () => {
  installGpuGlobals();
  const { device, lose } = mockGpu();
  lose('destroyed');
  const phases: string[] = [];
  const { fixture, backend } = quadBackend(device, { onDiagnostic: (e) => phases.push(e.phase) });
  await assert.rejects(backend.prepare(), /WEBGPU_LOST/);
  assert.ok(phases.includes('gpu-device-lost'));
  await backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});
