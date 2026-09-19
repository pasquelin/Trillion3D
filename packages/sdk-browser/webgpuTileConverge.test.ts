import test from 'node:test';
import assert from 'node:assert/strict';
import { mustRestartTaaAfterSettle, settlePose } from './webgpuTileConverge.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

test('a quiet barrier leaves TAA history in place', () => {
  assert.equal(mustRestartTaaAfterSettle(0, 0), false);
});

test('tiles or shadow pages that landed during the barrier restart the still TAA average', () => {
  assert.equal(mustRestartTaaAfterSettle(1, 0), true);
  assert.equal(mustRestartTaaAfterSettle(0, 3), true);
});

test('a held image is not redrawn by the pose barrier', async () => {
  let pumped = 0;
  const rt = {
    run: { frameHeld: true, lastCamera: {}, lost: false, textureConverging: false },
    capture: { secondaryCamera: undefined },
    vis: {
      textures: {
        feedback: { entries: 1 },
        pump() {
          pumped++;
          return { served: 1, waiting: 0 };
        },
        settled: async () => {},
        reading: false,
      },
    },
    diag: { engineDiagnostic() {} },
    lights: { plan: { counts: { pendingPages: 0 } } },
  } as unknown as WebgpuPagesRuntime;
  await settlePose(rt, { queue: { onSubmittedWorkDone: async () => {} } } as GPUDevice);
  assert.equal(pumped, 0, 'the barrier must not pump tiles over a held image');
  assert.equal(rt.run.textureConverging, false);
});
