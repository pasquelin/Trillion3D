// The shadow maps' pipelines are compiled off the thread before the first frame
// (`prepareVsmPipelines`): for the set the scene's casting lights are first granted, every compute
// pipe of the shadow passes — invalidation, marking, page management, the raster's candidates,
// cull, expand and arguments —, the raster's render pipeline and the projection's twin. The first
// lit frame then creates no shadow pipeline at once; the projection's kind variant it asks compiles
// off the thread too, the twin drawing meanwhile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../../../../../../sdk-core/src/index.ts';
import { SUN } from '../../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { installGpuGlobals } from '../../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../../tests/kit/gpu/mockGpu.ts';
import { SHADOW_LIMITS, camera, disposeQuadRun, quadBackend } from '../../testScenes.fixture.ts';

/** A pipeline's name, before the tag the session gives its label (`vsm.projection @t3d:1`). */
const nameOf = (descriptor: { label?: string }) => (descriptor.label ?? '').split(' ')[0];

test('the first lit frame creates no shadow pipeline at once: prepare compiled them off the thread', async () => {
  installGpuGlobals();
  const gpu = mockGpu({ limits: SHADOW_LIMITS, compute: true });
  const sceneLights = createSceneLightStore();
  sceneLights.add(SUN);
  const { fixture, backend } = quadBackend(gpu.device, { sceneLights });
  const made = { sync: [] as string[], async: [] as string[] };
  const device = gpu.device as GPUDevice;
  const compute = device.createComputePipeline.bind(device),
    render = device.createRenderPipeline.bind(device);
  device.createComputePipeline = (d) => (made.sync.push(nameOf(d)), compute(d));
  device.createRenderPipeline = (d) => (made.sync.push(nameOf(d)), render(d));
  device.createComputePipelineAsync = async (d) => (made.async.push(nameOf(d)), compute(d));
  device.createRenderPipelineAsync = async (d) => (made.async.push(nameOf(d)), render(d));
  const shadow = (names: string[]) => names.filter((name) => name.startsWith('vsm.'));
  try {
    await backend.prepare();
    assert.deepEqual(shadow(made.sync), [], 'prepare creates none at once');
    const prepared = shadow(made.async);
    assert.ok(prepared.length >= 20, `${prepared.length} shadow pipelines compiled by prepare`);
    assert.ok(prepared.includes('vsm.render.raster') && prepared.includes('vsm.projection'));
    made.sync.length = made.async.length = 0;
    backend.render(camera());
    await backend.flush?.();
    assert.ok(backend.metrics().shadowVsmLights, 'the frame shadowed its sun');
    assert.deepEqual(shadow(made.sync), [], 'the frame creates none at once');
    assert.deepEqual(shadow(made.async), ['vsm.projection'], 'its kind variant, off the thread');
  } finally {
    disposeQuadRun(backend, fixture);
  }
});
