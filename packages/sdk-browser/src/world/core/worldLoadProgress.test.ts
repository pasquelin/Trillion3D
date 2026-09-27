import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JobProgress } from '../../../../sdk-core/src/index.ts';
import { worldModelLoader } from './worldLoader.ts';
import { Scene } from './scene.ts';
import { HOST } from './worldRuntime.fixture.ts';

const manifest = (example: string) =>
  `${HOST}assets/examples/${example}/cache/native/full/manifest.json`;

/** Every event a load of the example cache reports, its images read by the host (`webgl2`). */
async function heardLoading(
  example = 'detail-by-pixel-error',
  renderer: 'webgpu' | 'webgl2' = 'webgpu',
) {
  const scene = new Scene(worldModelLoader(Promise.resolve(), undefined, () => renderer));
  const heard: JobProgress[] = [];
  await scene.load(manifest(example), { onProgress: (event) => heard.push(event) });
  return heard;
}

test('scene.load reports the manifest, the tables, then every resource the scene reads', async (t) => {
  // Images decode to a stand-in: what is heard is that each was read.
  Object.assign(globalThis, { createImageBitmap: async () => ({ width: 1, height: 1 }) });
  t.after(() => delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap);
  const heard = await heardLoading('bust', 'webgl2');
  const phases = heard.map((event) => event.phase).filter((phase) => phase !== 'bytes');
  assert.equal(phases[0], 'manifest');
  assert.ok(phases.indexOf('tables') > 0, 'the scene tables are reported once read');
  const resources = heard.filter((event) => event.phase === 'resources');
  assert.ok(resources.length > 0, 'the scene reads its images');
  const last = resources.at(-1)!;
  assert.equal(last.completed, last.total, 'the last resource closes the count');
});

test('scene.load reports bytes against the files it reads: the share rises, full with the last', async () => {
  // The site is served with no Content-Length, one chunk per file: the plan alone sets the total.
  const bytes = (await heardLoading()).filter((event) => event.phase === 'bytes');
  assert.ok(bytes.length > 1, 'bytes are heard while the files arrive');
  const shares = bytes.map((event) => (event.completed as number) / (event.total as number));
  assert.ok(
    shares.every((share, at) => at === 0 || share >= shares[at - 1]!),
    `never back: ${shares}`,
  );
  assert.ok(
    shares.slice(0, -2).every((share) => share < 1),
    `full only once the last file lands: ${shares}`,
  );
  assert.ok((bytes[0]!.total as number) > 0, 'the first event already counts the planned files');
  const last = bytes.at(-1)!;
  assert.equal(last.completed, last.total, 'the load closes the count');
  // The plan holds only the files the load reads: the last file lands the share near full, and
  // settling drops nothing more than a file the load skipped.
  assert.ok(shares.at(-2)! > 0.95, `the last file fills the share before settling: ${shares}`);
});
