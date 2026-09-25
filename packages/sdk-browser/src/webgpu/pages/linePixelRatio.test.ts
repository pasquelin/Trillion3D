import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './pages.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera } from './testScenes.fixture.ts';

/** The words of the buffer `label` names, after the frames of a line surface 2.5 CSS pixels wide
 *  at a pixel ratio of 2; `fallback` draws through the non-visibility pipeline, `transparent`
 *  through the blend pass, and `dashed` gives the line a dash of 0.25 and a gap of 0.5. */
async function frameWords(fallback: boolean, transparent = false, dashed = false) {
  installGpuGlobals();
  const scene = quadScene();
  scene.material.lineWidth = 2.5;
  if (dashed) Object.assign(scene.material, { dashSize: 0.25, gapSize: 0.5 });
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
  assert.equal(blend('Trillion3D blend view uniform')[32], 2, 'BlendView.pixelRatio');
  assert.equal(blend('Trillion3D blend item records')[25], 2.5, 'BlendItem.lineWidth');
});

test('the fallback pipeline widens a line page with its width, the pixel ratio and the image', async () => {
  const words = await frameWords(true);
  assert.deepEqual([...words('Trillion3D fallback uniforms').subarray(40, 44)], [2.5, 2, 32, 32]);
});

// #359: a dashed line's dash and gap reach every WebGPU path that draws it — the page row both
// rasters cut it by (a masked row, of threshold zero), the blend record and the fallback uniform —;
// a solid line's words stay zero, and its row is not masked.
test('a dashed line writes its dash and gap where every WebGPU path reads them', async () => {
  for (const dashed of [false, true]) {
    const dash = dashed ? [0.25, 0.5] : [0, 0];
    const words = await frameWords(false, false, dashed);
    const row = words('Trillion3D page table');
    assert.deepEqual([...row.subarray(28, 30)], dash, 'PageInfo.dash');
    const flags = new Uint32Array(row.buffer, row.byteOffset, row.length)[23];
    assert.equal((flags & 128) !== 0, dashed, 'the cutout reads it');
    assert.equal(row[19], dashed ? 0 : 1, 'no alpha threshold beside the gaps');
    const blend = await frameWords(false, true, dashed);
    assert.deepEqual([...blend('Trillion3D blend item records').subarray(40, 42)], dash);
    const fallback = await frameWords(true, false, dashed);
    assert.deepEqual([...fallback('Trillion3D fallback uniforms').subarray(44, 46)], dash);
  }
});
