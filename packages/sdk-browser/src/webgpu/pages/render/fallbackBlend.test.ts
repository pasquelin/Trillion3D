// #584: with no visibility buffer, a paged transparent surface is drawn by the fallback pass in
// its own mode and with its own alpha — it once went through the blend pass's indirect arguments,
// which the fallback shader reads no instance of, and drew nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { webgpuPagesBackend } from '../pages.ts';
import { camera, disposeQuadRun, quadScene } from '../testScenes.fixture.ts';
import { UNIFORM_STRIDE } from '../../blend/uniforms.ts';
import { BLEND_EQUATIONS, hostBlending } from '../../../scene/materialBlending.ts';
import type { Blending } from '../../../../../sdk-core/src/world/constants/index.ts';

const OPACITY = 0.8;

/** The fallback pass's draws of the quad in `mode`, and the uniform words of each. */
async function fallbackDraws(mode: Blending) {
  installGpuGlobals();
  const { device, draws, passes, buffers } = mockGpu({ rejectR32: true });
  const fixture = quadScene();
  Object.assign(fixture.material, {
    transparent: true,
    opacity: OPACITY,
    blending: hostBlending(mode),
  });
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush?.();
    assert.ok(
      backend.capabilities.unsupported.includes('visibility buffer'),
      'witness: the image fell back',
    );
    const drawn = draws.length,
      opened = passes.length;
    backend.render(camera());
    assert.deepEqual(
      passes.slice(opened).map((pass) => pass.label),
      ['Trillion3D clear', 'Trillion3D transparents'],
    );
    const uniforms = buffers.find((buffer) => buffer.label === 'Trillion3D fallback uniforms')!;
    const slot = (draw: number) => {
      const at = uniforms.data.byteOffset + draw * UNIFORM_STRIDE;
      return {
        floats: new Float32Array(uniforms.data.buffer, at, UNIFORM_STRIDE / 4),
        ints: new Uint32Array(uniforms.data.buffer, at, UNIFORM_STRIDE / 4),
      };
    };
    return draws.slice(drawn).map((draw, index) => ({ draw, ...slot(index) }));
  } finally {
    disposeQuadRun(backend, fixture);
  }
}

for (const mode of ['normal', 'additive', 'subtractive', 'multiply'] as const)
  test(`the fallback pass draws a paged ${mode} surface in its pipeline, with its alpha`, async () => {
    const drawn = await fallbackDraws(mode);
    // One draw per cluster of the quad, each the three indices of its span in the page cache.
    assert.equal(drawn.length, 2);
    for (const { draw, floats, ints } of drawn) {
      assert.equal(draw.indirect, undefined, 'the fallback shader reads no instance');
      assert.equal(draw.vertexCount, 3);
      assert.deepEqual(draw.blend, BLEND_EQUATIONS[mode]);
      assert.equal(ints[37], 3, 'Uniforms.indexCount');
      assert.ok(Math.abs(floats[35] - OPACITY) < 1e-6, 'Uniforms.color.a');
    }
    assert.notEqual(drawn[0].ints[36], drawn[1].ints[36], 'each cluster reads its own span');
  });
