import test from 'node:test'
import assert from 'node:assert/strict'
import { prepare, prepareMany, createCompilationJob } from './index.mts'
import { DEFAULT_SCOPE } from '../../sdk-core/src/contracts/base.ts'
import { getSdkProvenance } from './compiler/provenance.mts'
import { resolveCompilerExecutable } from './compiler/executable.mts'
import type { BatchJob } from './compiler/contracts.ts'
import type { JobField } from '../../sdk-core/src/contracts/compilerAbi.ts'

/** One hashed file of `getSdkProvenance()`'s snapshot, as this test reads it: hashes only, no
 *  embedded source text, whatever the caller might otherwise expect from the field name. */
interface FileProvenance {
  sha256: string
  text?: unknown
}

test('Node SDK public API imports without executing a compiler or depending on UI', () => {
  assert.equal(typeof prepare, 'function')
  assert.equal(typeof prepareMany, 'function')
  assert.equal(typeof createCompilationJob, 'function')
  assert.equal(typeof getSdkProvenance, 'function')
})
test('Compilation jobs expose the shared slice default', () => {
  assert.equal(DEFAULT_SCOPE, 'slice')
})
test('a batch job names the fields of one compile job, as the single job names them', () => {
  // Type-checked: a batch field the compile job does not declare (the former `triangles`), or a
  // job field the batch misses, makes this assignment fail to compile.
  type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
  const same: SameKeys<Exclude<keyof BatchJob, 'id'>, JobField> = true
  assert.equal(same, true)
})
test('compiler executable selection is explicit, then environment, then package-relative', () => {
  assert.equal(
    resolveCompilerExecutable('/explicit', { TRILLION3D_COMPILER_BIN: '/env' }),
    '/explicit',
  )
  assert.equal(resolveCompilerExecutable(undefined, { TRILLION3D_COMPILER_BIN: '/env' }), '/env')
  assert.match(resolveCompilerExecutable(undefined, {}, 'win32'), /trillion3d-compiler\.exe$/)
})
test('a missing compiler is reported by contract', async () => {
  await assert.rejects(
    prepare('in', 'out', 'slice', 1, {
      executable: '/missing/trillion3d-compiler',
      resourceBaseUrl: '/assets/',
    }),
    /COMPILER_EXECUTABLE_MISSING: .*\/missing\/trillion3d-compiler/,
  )
})
test('getSdkProvenance hashes files without embedding source text', async () => {
  const provenance = await getSdkProvenance()
  assert.equal(provenance.sdkVersion, '1.0.0')
  const sample = Object.values(provenance.files)[0] as FileProvenance
  assert.equal(typeof sample.sha256, 'string')
  assert.equal(sample.text, undefined)
  assert.ok(provenance.files['dist/sdk-node/src/index.mjs'])
  assert.equal(
    provenance.scope,
    'Installed JavaScript files; external compiler binary equality not established',
  )
})
test('prepareMany refuses a job without resourceBaseUrl before spawning anything', async () => {
  // A `BatchJob` missing its required `resourceBaseUrl`, as an untyped caller could still send it:
  // the point of this test is the run-time guard the type system would otherwise make moot.
  const job = { id: 'a', source: 's', cache: 'c' } as BatchJob
  await assert.rejects(prepareMany([job]), /resourceBaseUrl/)
})
