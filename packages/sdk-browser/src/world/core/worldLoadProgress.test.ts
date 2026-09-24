import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JobProgress } from '../../../../sdk-core/src/index.ts';
import { worldModelLoader } from './worldLoader.ts';
import { Scene } from './scene.ts';
import { HOST } from './worldRuntime.fixture.ts';

test('scene.load reports the manifest, then every resource the scene reads', async () => {
  const scene = new Scene(worldModelLoader(Promise.resolve(), undefined, () => 'webgpu'));
  const heard: JobProgress[] = [];
  await scene.load(`${HOST}assets/examples/detail-by-pixel-error/cache/native/full/manifest.json`, {
    onProgress: (event) => heard.push(event),
  });
  assert.equal(heard[0]?.phase, 'manifest');
  const resources = heard.filter((event) => event.phase === 'resources');
  assert.ok(resources.length > 0, 'the scene reads at least its binary');
  const last = resources.at(-1)!;
  assert.equal(last.completed, last.total, 'the last resource closes the count');
});
