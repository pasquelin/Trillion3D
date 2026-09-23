// Recorded browser captures that back engine claims the portal used to show: kept as test
// fixtures, never served with the site.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const fixture = (name: string) => new URL(`../fixtures/site-proofs/${name}`, import.meta.url);
const json = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(fixture(name), 'utf8')) as T;

interface ObservatorySample {
  selected: number;
  restoredDifference: number;
  stillDifference: number;
}

interface OcclusionSample {
  height: number;
  angle: number;
  held: boolean;
  hizRejectedClusters: number;
}

test('the observatory drops detail with the pixel error and restores it exactly', async () => {
  const proof = await json<{
    resolution: number[];
    dpr: number;
    samples: ObservatorySample[];
  }>('observatory-proof.json');
  const [fine, , coarse, restored] = proof.samples;
  assert.deepEqual(proof.resolution, [1600, 1040]);
  assert.equal(proof.dpr, 2);
  assert.equal(fine.selected, 91_352);
  assert.equal(coarse.selected, 7_132);
  assert.equal(restored.selected, fine.selected);
  assert.equal(restored.restoredDifference, 0);
  assert.equal(restored.stillDifference, 0);
  const [detailed, simplified] = await Promise.all(
    ['observatory-detail-0.png', 'observatory-detail-8.png'].map((name) => readFile(fixture(name))),
  );
  assert.notDeepEqual(detailed, simplified);
});

test('the hierarchical depth test hides more of the garden the lower the eye', async () => {
  const proof = await json<{ samples: OcclusionSample[] }>('occlusion-two-phase-proof.json');
  const at = (height: number, angle: number) => {
    const sample = proof.samples.find((s) => s.height === height && s.angle === angle);
    assert.ok(sample, `no sample at height=${height} angle=${angle}`);
    return sample.hizRejectedClusters;
  };
  assert.ok(
    proof.samples.every(({ held }) => held),
    'every pose was held before reading',
  );
  assert.ok(at(1.45, 90) > at(1.45, 0));
  assert.ok(at(1.45, 0) > at(1.45, 45));
  assert.equal(at(6, 0), 0, 'nothing hides a ring seen from above');
});

test('switching a light shadow off changes the captured image', async () => {
  const [on, off] = await Promise.all(
    ['shadow-casting-switch-on.png', 'shadow-casting-switch-off.png'].map((name) =>
      readFile(fixture(name)),
    ),
  );
  assert.notDeepEqual(on, off);
});
