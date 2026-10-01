// #1362: the pools funded again once the frame targets are in place never hold a frame, granted
// or refused: the lamp examples open at 1728×1117 DPR 2 (3456×2234) and keep presenting.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneLightStore } from '../../../../../sdk-core/src/index.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { DEFAULT_CPU_BUDGET, splitMemoryBudget } from '../../../residency/memoryBudget.ts';
import type { ActiveGpuMemory } from '../../../residency/activeMemory.ts';
import { LAMP_SCENES } from '../../frame/lampScenes.fixture.ts';
import { SHADOW_LIMITS, camera, disposeQuadRun, quadBackend } from '../testScenes.fixture.ts';

installGpuGlobals();

/** The world's admission (`sessionPools`), `room` bytes left to the pools beside what is held:
 *  every live byte moves them, and a negative room refuses them (`GPU_BUDGET_UNDER_MINIMUM`). */
function pressedBudget() {
  const budget = { asked: 0, room: 256 << 20 };
  const admit = (active: ActiveGpuMemory) => {
    budget.asked++;
    const held = active.shadowPool + active.bounceProbes + active.effectTargets;
    const total = held + active.frameTargets + budget.asked + budget.room;
    const pools = splitMemoryBudget(total, DEFAULT_CPU_BUDGET, undefined, active);
    return { geometryPoolBytes: pools.geometryPool, texturePoolBytes: pools.texturePool };
  };
  return { budget, admit };
}

for (const [name, lights] of Object.entries(LAMP_SCENES))
  test(`${name} at 3456×2234: no frame is held on the pools' funding`, async () => {
    const gpu = mockGpu({ limits: SHADOW_LIMITS, compute: true });
    const sceneLights = createSceneLightStore();
    for (const light of lights) sceneLights.add(light);
    const { budget, admit } = pressedBudget();
    const { fixture, backend } = quadBackend(gpu.device, {
      viewport: [3456, 2234],
      sceneLights,
      admitGpuMemory: admit,
    });
    const grown: GPUBuffer[] = [];
    // A lamp's resources grow: the device ledger moves, and the pools are funded again.
    const grow = () =>
      grown.push(gpu.device.createBuffer({ label: 'lamp', size: 1 << 20, usage: 0x80 }));
    const presented = () => (backend.metrics().drawCalls ?? 0) > 1;
    try {
      await backend.prepare();
      backend.render(camera());
      // A shadow pool still asked of the device holds it (#483), never the pools' funding.
      if (!presented()) {
        await backend.flush?.();
        backend.render(camera());
      }
      assert.ok(presented(), 'the first frame is presented');
      // Its own funding, still in flight, answers: one funding at a time.
      await backend.flush?.();
      for (const refused of [false, true]) {
        budget.room = refused ? -(1 << 30) : 256 << 20;
        const asked = budget.asked;
        grow();
        for (let frame = 0; frame < 3; frame++) {
          backend.render(camera());
          assert.ok(presented(), `${refused ? 'refused' : 'in flight'}: frame ${frame} presented`);
        }
        assert.equal(budget.asked, asked + 1, 'funded again once, not every frame');
        await backend.flush?.();
        const settled = budget.asked;
        for (let frame = 0; frame < 3; frame++) {
          backend.render(camera());
          assert.ok(presented(), `${refused ? 'refused' : 'granted'}: frame ${frame} presented`);
        }
        assert.equal(budget.asked, settled, 'a still ledger asks nothing');
      }
    } finally {
      for (const buffer of grown) buffer.destroy();
      disposeQuadRun(backend, fixture);
    }
  });

test('a resize while the pools are funded again waits for that funding: one moves the pools at a time', async () => {
  const gpu = mockGpu({ limits: SHADOW_LIMITS, compute: true });
  const sceneLights = createSceneLightStore();
  for (const light of LAMP_SCENES['a-lighthouse-beam']) sceneLights.add(light);
  const { budget, admit } = pressedBudget();
  const viewport: [number, number] = [1728, 1117];
  const { fixture, backend } = quadBackend(gpu.device, {
    viewport,
    sceneLights,
    admitGpuMemory: admit,
  });
  const lamp = { buffer: undefined as GPUBuffer | undefined };
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush?.();
    backend.render(camera());
    lamp.buffer = gpu.device.createBuffer({ label: 'lamp', size: 1 << 20, usage: 0x80 });
    backend.render(camera());
    const funding = budget.asked;
    // The view grows while that funding is in flight: its targets are asked once it landed.
    viewport.splice(0, 2, 3456, 2234);
    backend.render(camera());
    assert.equal(budget.asked, funding, 'the targets wait for the pools in flight');
    await backend.flush?.();
    assert.ok(budget.asked > funding, 'then are funded');
  } finally {
    lamp.buffer?.destroy();
    disposeQuadRun(backend, fixture);
  }
});
