import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepare,
  prepareMany,
  createCompilationJob,
  DEFAULT_SCOPE,
  getSdkProvenance,
  resolveCompilerExecutable,
} from './index.mts';
import type { BatchJob } from './compiler/contracts.ts';

/** One hashed file of `getSdkProvenance()`'s snapshot, as this test reads it: hashes only, no
 *  embedded source text, whatever the caller might otherwise expect from the field name. */
interface FileProvenance {
  sha256: string;
  text?: unknown;
}

test('Node SDK public API imports without executing a compiler or depending on UI', () => {
  assert.equal(typeof prepare, 'function');
  assert.equal(typeof prepareMany, 'function');
  assert.equal(typeof createCompilationJob, 'function');
  assert.equal(typeof getSdkProvenance, 'function');
});
test('Compilation jobs expose the shared slice default', () => {
  assert.equal(DEFAULT_SCOPE, 'slice');
});
test('compiler executable selection is explicit, then environment, then package-relative', () => {
  assert.equal(
    resolveCompilerExecutable('/explicit', { WEB_GEOMETRY_COMPILER_BIN: '/env' }),
    '/explicit',
  );
  assert.equal(resolveCompilerExecutable(undefined, { WEB_GEOMETRY_COMPILER_BIN: '/env' }), '/env');
  assert.match(resolveCompilerExecutable(undefined, {}, 'win32'), /web-geometry-compiler\.exe$/);
});
test('a missing compiler is reported by contract', async () => {
  await assert.rejects(
    prepare('in', 'out', 'slice', 1, {
      executable: '/missing/web-geometry-compiler',
      resourceBaseUrl: '/assets/',
    }),
    /COMPILER_EXECUTABLE_MISSING: \/missing\/web-geometry-compiler/,
  );
});
test('getSdkProvenance hashes files without embedding source text', async () => {
  const provenance = await getSdkProvenance();
  assert.equal(provenance.sdkVersion, '0.2.0');
  const sample = Object.values(provenance.files)[0] as FileProvenance;
  assert.equal(typeof sample.sha256, 'string');
  assert.equal(sample.text, undefined);
  assert.ok(provenance.files['dist/sdk-node/src/index.mjs']);
  assert.equal(
    provenance.scope,
    'Installed JavaScript files; external compiler binary equality not established',
  );
});
test('prepareMany refuses a job without resourceBaseUrl before spawning anything', async () => {
  // A `BatchJob` missing its required `resourceBaseUrl`, as an untyped caller could still send it:
  // the point of this test is the run-time guard the type system would otherwise make moot.
  const job = { id: 'a', source: 's', cache: 'c' } as BatchJob;
  await assert.rejects(prepareMany([job]), /resourceBaseUrl/);
});
