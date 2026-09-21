import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BUNDLES, buildDocs, staleBundles } from './docs/bundles.mjs';

// No bundle is committed on develop: the build runs on demand, here once, and the release
// check that compares main against a fresh build is proved on a copy of that build.
const root = resolve(import.meta.dirname, '..');
let temporary, fresh;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'wg-docs-build-'));
  fresh = join(temporary, 'fresh');
  await buildDocs(root, fresh);
});
after(() => rm(temporary, { recursive: true, force: true }));

test('build:docs writes every published bundle from the maintained sources', async () => {
  for (const bundle of BUNDLES)
    assert.ok((await stat(join(fresh, bundle))).size > 0, `${bundle} is empty`);
  assert.deepEqual(await staleBundles(fresh, fresh), []);
});

test('the release check names a stale bundle and a missing one', async () => {
  const docs = join(temporary, 'docs');
  await cp(fresh, docs, { recursive: true });
  await appendFile(join(docs, 'runtime/engine.js'), '\n');
  await rm(join(docs, 'css/site.css'));
  assert.deepEqual(await staleBundles(fresh, docs), ['css/site.css', 'runtime/engine.js']);
});
