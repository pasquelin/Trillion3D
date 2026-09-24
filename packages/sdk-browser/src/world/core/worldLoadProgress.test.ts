import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JobProgress } from '../../../../sdk-core/src/index.ts';
import { worldModelLoader } from './worldLoader.ts';
import { Scene } from './scene.ts';
import { HOST } from './worldRuntime.fixture.ts';

const MANIFEST = `${HOST}assets/examples/detail-by-pixel-error/cache/native/full/manifest.json`;

/** Every event a load of the example cache reports. */
async function heardLoading() {
  const scene = new Scene(worldModelLoader(Promise.resolve(), undefined, () => 'webgpu'));
  const heard: JobProgress[] = [];
  await scene.load(MANIFEST, { onProgress: (event) => heard.push(event) });
  return heard;
}

test('scene.load reports the manifest, the tables, then every resource the scene reads', async () => {
  const heard = await heardLoading();
  const phases = heard.map((event) => event.phase).filter((phase) => phase !== 'bytes');
  assert.equal(phases[0], 'manifest');
  assert.ok(phases.indexOf('tables') > 0, 'the scene tables are reported once read');
  const resources = heard.filter((event) => event.phase === 'resources');
  assert.ok(resources.length > 0, 'the scene reads at least its binary');
  const last = resources.at(-1)!;
  assert.equal(last.completed, last.total, 'the last resource closes the count');
});

test('scene.load reports the bytes of every file as they land, up to their total', async () => {
  const bytes = (await heardLoading()).filter((event) => event.phase === 'bytes');
  assert.ok(bytes.length > 1, 'bytes are heard while the files arrive');
  const counts = bytes.map((event) => event.completed as number);
  assert.ok(
    counts.every((count, at) => at === 0 || count >= counts[at - 1]!),
    'never back',
  );
  const last = bytes.at(-1)!;
  assert.ok((last.total as number) > 100_000, 'the manifest, tables and binary are all counted');
  assert.equal(last.completed, last.total, 'the last chunk reaches the total');
});
