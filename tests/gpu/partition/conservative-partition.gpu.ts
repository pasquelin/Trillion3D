// The GPU partition is conservative, cluster by cluster. The bench scene with twelve instances and
// thirty poses along the bench trajectory; after each frame, what the GPU wrote for every resident
// row is held against the engine's double-precision reference on the same inputs, and three rules
// are counted on every row of every pose: the GPU rectangle contains the reference's, a box the
// near plane clips carries the clip flag, and the GPU depth bound stands nearer than the
// reference's, the layer's bias included. Zero violations is the only acceptable count; the
// margins are published. Every transparent cluster the occlusion test removed must stay rejected
// by the reference (`conservativePartitionPage.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_SCENE, sceneDerived } from '../../../bench/runner/assets/scene.ts';
import { cacheHoldsBlend } from '../../../bench/runner/assets/cacheManifest.ts';
import { loadPage, runOnDawn } from '../kit/onDawn.ts';

const POSES = 30;
const cache = join(sceneDerived(DEFAULT_SCENE), 'native/full');

test('the GPU partition is conservative on every row of every pose', async () => {
  const manifest = join(cache, 'manifest.json');
  assert.ok(existsSync(manifest), `setup: the bench scene's cache is missing (${manifest})`);
  const page = (await loadPage(
    resolve(import.meta.dirname, 'conservativePartitionPage.ts'),
    'conservativePartition',
  )) as typeof import('./conservativePartitionPage.ts');
  const pageErrors: string[] = [];
  const reading = await runOnDawn(
    page.auditPoses,
    {
      manifestUrl: pathToFileURL(manifest).href,
      width: 1012,
      height: 1000,
      instances: 12,
      pixelError: 1,
      maxPages: 100000,
      warmup: 8,
      poses: POSES,
    },
    pageErrors,
  );
  console.log(JSON.stringify({ ...reading, frames: reading.frames?.slice(-3) }, null, 2));
  assert.equal(reading.erreur ?? null, null, String(reading.erreur));
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(reading.evenements, [], 'the engine reported a fallback or an error');
  const { total, frames, occlusion, occlusionViolations } = reading;
  assert.ok(total && frames && occlusion && occlusionViolations);
  assert.equal(frames.length, POSES, 'every pose is audited');
  assert.ok(total.rows > 0, 'no resident row was compared');
  assert.equal(total.containmentViolations, 0, 'GPU rectangles narrower than the reference');
  assert.equal(total.clipViolations, 0, 'boxes the near plane clips without the clip flag');
  assert.equal(total.depthViolations, 0, 'GPU depths past the reference');
  // The cut runs on the GPU throughout; holes are `dag/held-gpu-cut.gpu.ts`'s to prove.
  for (const { cpuSelectMs, gpuSelectionFallback } of frames) {
    assert.equal(cpuSelectMs, null, 'the cut fell back to the CPU');
    assert.equal(gpuSelectionFallback, false, 'GPU selection was abandoned');
  }
  // Without an occlusion reject, conservativeness proves nothing.
  assert.ok(
    frames.some(({ hizRejectedClusters }) => (hizRejectedClusters ?? 0) > 0),
    'the Hi-Z test rejected no cluster: the proof covers nothing',
  );
  assert.deepEqual(
    occlusionViolations,
    [],
    'removed transparent clusters stay visible to the reference',
  );
  // A cache without a transparent cluster leaves the transparent half nothing to examine.
  if (await cacheHoldsBlend(cache)) {
    assert.ok(occlusion.examined > 0, 'no transparent cluster was examined');
    assert.ok(occlusion.rejected > 0, 'the transparent occlusion test rejected nothing');
    assert.equal(occlusion.violations, 0, 'transparent clusters wrongly rejected');
  } else assert.equal(occlusion.examined, 0, 'transparent clusters examined with none cached');
});
