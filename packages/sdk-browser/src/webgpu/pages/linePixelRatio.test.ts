import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './pages.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera } from './testScenes.fixture.ts';

/** The words of the buffer `label` names, after the frames of a line surface 2.5 CSS pixels wide
 *  at a pixel ratio of 2; `fallback` draws through the non-visibility pipeline, `transparent`
 *  through the blend pass. */
async function frameWords(fallback: boolean, transparent = false) {
  installGpuGlobals();
  const scene = quadScene();
  scene.material.lineWidth = 2.5;
  if (transparent) Object.assign(scene.material, { transparent: true, opacity: 0.5 });
  const { device, buffers } = mockGpu(fallback ? { rejectR32: true } : { compute: true });
  const backend = webgpuPagesBackend({
    ...scene,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
    pixelRatio: () => 2,
  });
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush?.();
    backend.render(camera());
    await backend.flush?.();
    return (label: string) => {
      const buffer = buffers.find((candidate) => candidate.label === label);
      assert.ok(buffer, label);
      return new Float32Array(buffer.data.buffer, buffer.data.byteOffset, buffer.size / 4);
    };
  } finally {
    await backend.dispose();
    scene.geometry.dispose();
    scene.material.dispose();
  }
}

// #348: a line's width counts CSS pixels, as the reference's `LineMaterial`: every WebGPU pass that
// widens a line reads the host's pixel ratio, and the shared `lineClip` draws width × ratio.
test('the rasters, the resolve and the blend pass read the host pixel ratio', async () => {
  const words = await frameWords(false);
  assert.equal(words('Trillion3D visibility uniforms')[25], 2, 'Uniforms.pixelRatio');
  assert.equal(words('Trillion3D resolve uniform')[18], 2, 'ShadeUni.pixelRatio');
  const blend = await frameWords(false, true);
  assert.equal(blend('Trillion3D blend view uniform')[28], 2, 'BlendView.pixelRatio');
  assert.equal(blend('Trillion3D blend item records')[25], 2.5, 'BlendItem.lineWidth');
});

test('the fallback pipeline widens a line page with its width, the pixel ratio and the image', async () => {
  const words = await frameWords(true);
  assert.deepEqual([...words('Trillion3D fallback uniforms').subarray(40, 44)], [2.5, 2, 32, 32]);
});
