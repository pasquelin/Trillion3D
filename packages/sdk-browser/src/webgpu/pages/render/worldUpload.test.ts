// A pose the host wrote rewrites the table whichever cut draws the image (#428): without the GPU
// cut — the CPU fallback — the rows used to keep their old world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadWorlds } from './worldUpload.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { EngineCamera } from '../../../camera/world.ts';

/** An image entry after a scene change; `walked` says whether the host's write made it. */
function image(walked: boolean, gpuSelection?: { updateWorlds: () => boolean }) {
  return {
    setup: { worlds: {} },
    layout: { selectionRoots: [], worldUpdates: new Float32Array(16), rows: { tableEpoch: 1 } },
    timing: { worldCounts: { racinesRebasees: 0 } },
    blendState: { blendGpu: [] },
    run: {
      gate: { updateWorlds: () => walked, revisions: { scene: 2 } },
      worldUploadRevision: 1,
      worldUploadOrigin: new Float64Array(3),
      gpuSelection,
      noOccluderHistory: false,
      temporalHizState: {},
    },
  } as unknown as WebgpuPagesRuntime;
}

const cam = { eye: [0, 0, 0] } as unknown as EngineCamera;

test('a host pose rewrites every row on the CPU cut as on the GPU cut, and only a host pose', () => {
  const cpu = image(true);
  assert.equal(uploadWorlds(cpu, cam), true);
  assert.equal(cpu.layout.rows.tableEpoch, 2, 'the CPU fallback rewrites the table');
  assert.equal(cpu.run.noOccluderHistory, true);
  const gpu = image(true, { updateWorlds: () => true });
  uploadWorlds(gpu, cam);
  assert.equal(gpu.layout.rows.tableEpoch, 2, 'the GPU cut too');
  const light = image(true, { updateWorlds: () => false });
  uploadWorlds(light, cam);
  assert.equal(light.layout.rows.tableEpoch, 1, 'a GPU cut whose worlds did not change keeps it');
  const engine = image(false);
  uploadWorlds(engine, cam);
  assert.equal(engine.layout.rows.tableEpoch, 1, 'a move the engine made rewrote its own rows');
});
