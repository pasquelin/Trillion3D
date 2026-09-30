import { createSceneLightStore } from '../../../../../sdk-core/src/index.ts';
import { SUN } from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { disposeQuadRun, quadBackend, SHADOW_LIMITS, camera } from '../testScenes.fixture.ts';
import { splitMemoryBudget, DEFAULT_CPU_BUDGET } from '../../../residency/memoryBudget.ts';
import type { ActiveGpuMemory } from '../../../residency/activeMemory.ts';
import * as G from '../../../host/graph/graph.fixture.ts';
import { hostSide } from '../../../scene/materialSide.ts';
import { DEFAULT_GPU_BUDGET } from '../../../residency/budget.fixture.ts';

const recordAdmission = (admissions: ActiveGpuMemory[]) => (active: ActiveGpuMemory) => {
  admissions.push(active);
  const pools = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, undefined, active);
  return { geometryPoolBytes: pools.geometryPool, texturePoolBytes: pools.texturePool };
};

test(
  'target admission during prepare completes without waiting for its own preparation',
  { timeout: 5000 },
  async () => {
    installGpuGlobals();
    const gpu = mockGpu();
    const admissions: ActiveGpuMemory[] = [];
    const { fixture, backend } = quadBackend(gpu.device, {
      admitGpuMemory: recordAdmission(admissions),
    });
    try {
      await backend.prepare();
      assert.equal(admissions.length, 1);
      assert.ok(admissions[0]!.frameTargets > 0);
      assert.ok(admissions[0]!.geometryMinimum >= 24, 'both root clusters keep coverage');
      assert.ok(gpu.textures.some((texture) => texture.label === 'Trillion3D HDR lighting'));
    } finally {
      disposeQuadRun(backend, fixture);
    }
  },
);

test('real 4K target constructors admit rough opaque and thin foliage resources within the declared total', async () => {
  installGpuGlobals();
  const gpu = mockGpu({ limits: SHADOW_LIMITS, compute: true });
  const sceneLights = createSceneLightStore();
  sceneLights.add(SUN);
  const admissions: ActiveGpuMemory[] = [];
  const { fixture, backend } = quadBackend(gpu.device, {
    viewport: [3840, 2160],
    sceneLights,
    temporalAntialiasing: true,
    admitGpuMemory: recordAdmission(admissions),
  });
  Object.assign(fixture.material, {
    family: 'standard',
    roughness: 0.5,
    side: hostSide('double'),
    subsurfaceColor: new G.Color().setRGB(0.2, 0.5, 0.1),
  });
  fixture.material.needsUpdate = true;
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush?.();
    backend.render(camera());
    await backend.flush?.();
    assert.ok(admissions.length >= 2);
    const foliage = gpu.textures.find(
      (t) => t.label === 'Trillion3D thin transmission' && !t.destroyed,
    );
    assert.deepEqual([foliage?.width, foliage?.height], [3840, 2160]);
    assert.ok(gpu.textures.some((t) => t.label?.includes('reflection history')));
    const actual = backend.metrics().gpuAllocatedBytes;
    assert.ok(typeof actual === 'number' && actual > 3840 * 2160 * 32);
    assert.ok(actual <= DEFAULT_GPU_BUDGET, `${actual} live bytes exceed ${DEFAULT_GPU_BUDGET}`);
    assert.ok(admissions[0].geometryMinimum >= 24, 'the two resident roots remain covered');
  } finally {
    disposeQuadRun(backend, fixture);
  }
});

test('later live allocations refresh the same budget, while unchanged resources do not repeat admission', async () => {
  installGpuGlobals();
  const gpu = mockGpu();
  const admissions: ActiveGpuMemory[] = [];
  const { fixture, backend } = quadBackend(gpu.device, {
    admitGpuMemory: recordAdmission(admissions),
  });
  let extra: GPUBuffer | undefined;
  try {
    await backend.prepare();
    for (let i = 0; i < 3; i++) {
      backend.render(camera());
      await backend.flush?.();
    }
    const before = admissions.at(-1)!;
    extra = gpu.device.createBuffer({
      label: 'extra shared diagnostic allocation',
      size: 4096,
      usage: GPUBufferUsage.STORAGE,
    });
    backend.render(camera());
    await backend.flush?.();
    assert.ok(admissions.at(-1)!.frameTargets >= before.frameTargets + 4096);
    const count = admissions.length;
    backend.render(camera());
    await backend.flush?.();
    assert.equal(admissions.length, count, 'no new allocation means no rebudget loop');
  } finally {
    extra?.destroy();
    disposeQuadRun(backend, fixture);
  }
});
