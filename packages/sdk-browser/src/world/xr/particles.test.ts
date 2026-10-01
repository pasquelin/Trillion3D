import test from 'node:test';
import assert from 'node:assert/strict';
import { createStereoCut } from '../../page/cut/stereo.ts';
import { encodeParticles } from '../../particles/webgpuParticleFrame.ts';
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts';
import { createFrameComposer } from '../render/compose.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts';
import { families } from '../../host/families.ts';
import type { RenderBackend } from '../../backend/types.ts';

test('GPU stereo steps shared particles once per headset frame without rendering a main view', () => {
  const stereo = createStereoCut();
  let steps = 0;
  const rt = {
    context: { particles: [{}], stereo },
    vis: { visEnabled: true },
    views: { active: {}, main: {} },
    gpu: { particles: { run: () => (++steps, 1) } },
    run: { gpuComputeDispatches: 0 },
  } as unknown as WebgpuPagesRuntime;
  for (let frame = 0; frame < 2; frame++) {
    stereo.begin([]);
    encodeParticles(rt, {} as GPUDevice, {} as GPUCommandEncoder);
    encodeParticles(rt, {} as GPUDevice, {} as GPUCommandEncoder);
    assert.equal(steps, frame + 1);
  }
  assert.equal(rt.run.gpuComputeDispatches, 2);
});

test('GL eye composers borrow the ordinary particle state and never dispose it on XR exit', async () => {
  await families.particles.load();
  const { gl, of } = createTestContext({ answers: { getExtension: () => ({}) } });
  const pool = new ParticlePool({ capacity: 8 }),
    particles = [pool];
  const main = createFrameComposer(gl, new Camera('perspective'), { particles });
  const left = createFrameComposer(gl, new Camera('perspective'), {
    particles,
    particleStep: main.particleStep,
  });
  const right = createFrameComposer(gl, new Camera('perspective'), {
    particles,
    particleStep: main.particleStep,
  });
  assert.equal(left.particleStep(), main.particleStep());
  assert.equal(right.particleStep(), main.particleStep());
  const backend = {
    id: 'fixture',
    scene: {},
    frameHeld: false,
    drawHostGeometry() {},
  } as unknown as RenderBackend;
  pool.emit(0, 0, -2, 0, 1, 0, 2);
  left(backend, null);
  const first = of('drawArraysInstanced').length;
  right(backend, null);
  assert.equal(
    of('drawArraysInstanced').length,
    first + 1,
    'the right eye draws the already stepped pool',
  );
  left.dispose();
  right.dispose();
  main(backend, null);
  assert.equal(
    of('drawArraysInstanced').length,
    first + 2,
    'ordinary rendering retains the particles after XR',
  );
  main.dispose();
});
