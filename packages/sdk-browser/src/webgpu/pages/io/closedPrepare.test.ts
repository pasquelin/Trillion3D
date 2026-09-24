// A backend closed before or while it prepares: cancelled, torn down once, nothing left on the
// world's device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { quadBackend } from '../testScenes.fixture.ts';
import type { RenderBackend } from '../../../backend/types.ts';

test('a backend closed while it prepares stops there, and leaves nothing on the device', async () => {
  installGpuGlobals();
  const { device, textures } = mockGpu();
  const phases: string[] = [];
  let closing: ReturnType<RenderBackend['dispose']> | undefined;
  const { fixture, backend } = quadBackend(device, {
    onDiagnostic: (e) => phases.push(e.phase),
    // Closed once its textures are under way: their next creation aborts.
    preparationStep: (step) => step === 'textures' && (closing = backend.dispose()),
  });
  await assert.rejects(backend.prepare(), { name: 'AbortError' });
  await closing;
  assert.ok(textures.length > 0);
  assert.deepEqual(
    textures.filter((texture) => !texture.destroyed).map((texture) => texture.label),
    [],
  );
  assert.ok(!phases.includes('webgpu-prepare-failed'), 'cancelled, not failed');
  assert.ok(!phases.includes('material-pipeline-failed'));
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('a backend closed before it prepares is cancelled, not lost', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const phases: string[] = [];
  const { fixture, backend } = quadBackend(device, { onDiagnostic: (e) => phases.push(e.phase) });
  const closing = backend.dispose();
  await assert.rejects(backend.prepare(), { name: 'AbortError' });
  // Closed once: whoever closes it again waits on the same closing.
  assert.equal(backend.dispose(), closing);
  await closing;
  assert.ok(!phases.includes('gpu-device-lost'));
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('a backend closed during a step starts no further one', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const steps: string[] = [];
  let closing: ReturnType<RenderBackend['dispose']> | undefined;
  const { fixture, backend } = quadBackend(device, {
    preparationStep: (step) => {
      steps.push(step);
      if (step === 'transparent compaction') closing = backend.dispose();
    },
  });
  await assert.rejects(backend.prepare(), { name: 'AbortError' });
  await closing;
  assert.equal(steps.at(-1), 'transparent compaction');
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test("a closed backend's reads answer nothing once the next session opens, and never throw", async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const first = quadBackend(device);
  await first.backend.prepare();
  const closing = first.backend.dispose();
  const next = quadBackend(device);
  await next.backend.prepare();
  await closing;
  assert.equal(await first.backend.shadowAtlasDigest?.(), null);
  assert.equal(await first.backend.partitionAudit?.(), null);
  assert.equal(await first.backend.transparentOcclusionAudit?.(), null);
  await next.backend.dispose();
  for (const { fixture } of [first, next]) {
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
