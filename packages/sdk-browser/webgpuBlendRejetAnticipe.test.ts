import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { BLEND_SHADER } from './webgpuBlendShader.ts';

/**
 * Early depth rejection of the blend pass, guarded by its fragment stage.
 *
 * On a tile GPU, a fragment stage that can write memory must run before the depth test — the
 * side effect must happen even for a fragment depth discards. The blend pass draws thousands of
 * calls fully hidden behind opaque: letting them shade cost 44 ms instead of 21, and 22 ms of
 * present instead of 0.7 (view `rue`, moving camera, image identical to the pixel).
 *
 * What this test guards is therefore not a line, it is a property of the stage: no write of any
 * kind, neither in the shader nor in the layout it declares. The alpha-test `discard` stays:
 * measured separately, dropping it on both paths yields only 0.4 ms of 21 — inside the A/A
 * witness noise of the same campaign. It does not block early rejection when depth is not
 * written, and a pipeline variant to avoid it would be code with no gain.
 */
test('the blend fragment stage writes nothing to memory', () => {
  const fragment = BLEND_SHADER.slice(BLEND_SHADER.indexOf('@fragment fn fs('));
  assert.ok(fragment.length > 0, 'the module does carry a fragment stage');
  for (const interdit of [/textureStore/, /atomic/, /@builtin\(frag_depth\)/]) {
    assert.doesNotMatch(fragment, interdit, `${interdit} forbidden in the fragment stage`);
  }
  // No writable storage binding, wherever it is declared: the driver reads the declaration,
  // not the use, to decide early rejection.
  assert.doesNotMatch(BLEND_SHADER, /var<storage,\s*read_write>/);
  assert.match(BLEND_SHADER, /var<storage,read> proxy:/, 'the proxy stays read, the ray is traced');
});

test('the blend layout declares no writable storage buffer', async () => {
  installGpuGlobals();
  const device = {
    createBindGroupLayout: (descriptor: unknown) => descriptor,
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createShaderModule: () => ({}),
  } as unknown as GPUDevice;
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  const entries = (blendBindGroupLayout as unknown as { entries: GPUBindGroupLayoutEntry[] })
    .entries;
  const inscriptibles = entries.filter(
    (entry) =>
      (entry.visibility & GPUShaderStage.FRAGMENT) !== 0 && entry.buffer?.type === 'storage',
  );
  assert.deepEqual(inscriptibles, [], 'a single one would be enough to lose early rejection');
  // The proxy is there, and read-only: the far surface keeps its sun shadow.
  assert.ok(
    entries.some((entry) => entry.buffer?.type === 'read-only-storage'),
    'the blend storage buffers are all read',
  );
});
